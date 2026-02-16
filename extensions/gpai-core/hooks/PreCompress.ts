import * as fs from 'fs'
import * as path from 'path'
import { normalizeMemoryEntry, readJsonl, type MemoryEntry, type MemoryTier } from '../utils/memory'

interface PreCompressInput {
  sessionId: string
  tokenUsage: number
  maxTokens: number
}

interface PreCompressOutput {
  compressedContext: string
  archivedCount: number
  metadata: Record<string, unknown>
}

export const PRECOMPRESS_POLICY = {
  hotKeepCount: 20,
  hotCompressionRatio: 0.85,
  warmRetentionDays: 21,
  warmMaxCount: 300,
  coldMaxCount: 1000
} as const

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function tierPath(gpaiDir: string, tier: MemoryTier): string {
  return path.join(gpaiDir, `data/memory/${tier}.jsonl`)
}

function parseTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) {
    return 0
  }
  return parsed
}

function sortByTimestamp(entries: MemoryEntry[], order: 'asc' | 'desc'): MemoryEntry[] {
  return [...entries].sort((a, b) => {
    const diff = parseTimestampMs(a.timestamp) - parseTimestampMs(b.timestamp)
    return order === 'asc' ? diff : -diff
  })
}

function memoryIdentity(entry: MemoryEntry): string {
  return `${entry.type}|${entry.sessionId || ''}|${entry.intent || ''}|${entry.timestamp}|${entry.content}`
}

function dedupeEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>()
  const deduped: MemoryEntry[] = []

  entries.forEach((entry) => {
    const identity = memoryIdentity(entry)
    if (seen.has(identity)) {
      return
    }
    seen.add(identity)
    deduped.push(entry)
  })

  return deduped
}

function loadTierEntries(gpaiDir: string, tier: MemoryTier): MemoryEntry[] {
  return readJsonl(tierPath(gpaiDir, tier))
    .map((item) => normalizeMemoryEntry(item, tier))
    .filter((item): item is MemoryEntry => Boolean(item))
}

function writeTierEntries(gpaiDir: string, tier: MemoryTier, entries: MemoryEntry[]): void {
  const filePath = tierPath(gpaiDir, tier)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  if (entries.length === 0) {
    fs.writeFileSync(filePath, '')
    return
  }

  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
}

function isOlderThanDays(entry: MemoryEntry, days: number, nowMs: number): boolean {
  const ageMs = nowMs - parseTimestampMs(entry.timestamp)
  return ageMs > days * 24 * 60 * 60 * 1000
}

function summarizeEntries(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return 'No notable recent events.'
  }

  const bullets = entries.slice(-10).map((entry) => {
    const content = String(entry.content || 'N/A').replace(/\s+/g, ' ').trim()
    return `- ${content}`
  })

  return bullets.join('\n')
}

export async function handlePreCompress(input: PreCompressInput): Promise<PreCompressOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const nowMs = Date.now()
    const hotEntries = sortByTimestamp(loadTierEntries(gpaiDir, 'hot'), 'asc')
    const warmEntries = sortByTimestamp(loadTierEntries(gpaiDir, 'warm'), 'asc')
    const coldEntries = sortByTimestamp(loadTierEntries(gpaiDir, 'cold'), 'asc')

    const shouldRotateHot =
      hotEntries.length > PRECOMPRESS_POLICY.hotKeepCount ||
      input.tokenUsage >= input.maxTokens * PRECOMPRESS_POLICY.hotCompressionRatio

    let hotToWarm: MemoryEntry[] = []
    let nextHot = hotEntries

    if (shouldRotateHot && hotEntries.length > PRECOMPRESS_POLICY.hotKeepCount) {
      const split = hotEntries.length - PRECOMPRESS_POLICY.hotKeepCount
      hotToWarm = hotEntries.slice(0, split)
      nextHot = hotEntries.slice(split)
    }

    const warmCombined = sortByTimestamp(dedupeEntries([...warmEntries, ...hotToWarm]), 'asc')
    const warmToColdByAge = warmCombined.filter((entry) =>
      isOlderThanDays(entry, PRECOMPRESS_POLICY.warmRetentionDays, nowMs)
    )
    const warmRecent = warmCombined.filter(
      (entry) => !isOlderThanDays(entry, PRECOMPRESS_POLICY.warmRetentionDays, nowMs)
    )

    const warmOverflow = Math.max(0, warmRecent.length - PRECOMPRESS_POLICY.warmMaxCount)
    const warmToColdByCount = warmOverflow > 0 ? warmRecent.slice(0, warmOverflow) : []
    const nextWarm = warmOverflow > 0 ? warmRecent.slice(warmOverflow) : warmRecent

    const warmToCold = sortByTimestamp(dedupeEntries([...warmToColdByAge, ...warmToColdByCount]), 'asc')
    const coldCombined = sortByTimestamp(dedupeEntries([...coldEntries, ...warmToCold]), 'asc')
    const coldPrunedCount = Math.max(0, coldCombined.length - PRECOMPRESS_POLICY.coldMaxCount)
    const nextCold = coldPrunedCount > 0 ? coldCombined.slice(coldPrunedCount) : coldCombined

    writeTierEntries(gpaiDir, 'hot', nextHot)
    writeTierEntries(gpaiDir, 'warm', nextWarm)
    writeTierEntries(gpaiDir, 'cold', nextCold)

    const recentEntries = sortByTimestamp(nextHot, 'desc').slice(0, 10)
    const rotationHappened = hotToWarm.length > 0 || warmToCold.length > 0 || coldPrunedCount > 0

    return {
      compressedContext: summarizeEntries(recentEntries),
      archivedCount: hotToWarm.length,
      metadata: {
        reason: rotationHappened ? 'tier-rotation-applied' : 'compression-not-required',
        tokenUsage: input.tokenUsage,
        maxTokens: input.maxTokens,
        hotToWarmCount: hotToWarm.length,
        warmToColdCount: warmToCold.length,
        coldPrunedCount,
        finalHotCount: nextHot.length,
        finalWarmCount: nextWarm.length,
        finalColdCount: nextCold.length
      }
    }
  } catch (error) {
    return {
      compressedContext: '',
      archivedCount: 0,
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}') as PreCompressInput
  handlePreCompress(input)
    .then((output) => {
      process.stdout.write(JSON.stringify(output))
      process.exit(0)
    })
    .catch((error: Error) => {
      process.stderr.write(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handlePreCompress
