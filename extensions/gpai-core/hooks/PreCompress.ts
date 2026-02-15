import * as fs from 'fs'
import * as path from 'path'
import { appendJsonl, readJsonl } from '../utils/memory'

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

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function summarizeEntries(entries: any[]): string {
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
  const hotPath = path.join(gpaiDir, 'data/memory/hot.jsonl')
  const warmPath = path.join(gpaiDir, 'data/memory/warm.jsonl')

  try {
    const hotEntries = readJsonl(hotPath)

    if (hotEntries.length <= 20 && input.tokenUsage < input.maxTokens * 0.85) {
      return {
        compressedContext: summarizeEntries(hotEntries),
        archivedCount: 0,
        metadata: {
          reason: 'compression-not-required'
        }
      }
    }

    const keepCount = 20
    const archiveEntries = hotEntries.slice(0, Math.max(0, hotEntries.length - keepCount))
    const recentEntries = hotEntries.slice(-keepCount)

    if (archiveEntries.length > 0) {
      archiveEntries.forEach((entry) => appendJsonl(warmPath, entry))
      fs.writeFileSync(hotPath, `${recentEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
    }

    return {
      compressedContext: summarizeEntries(recentEntries),
      archivedCount: archiveEntries.length,
      metadata: {
        tokenUsage: input.tokenUsage,
        maxTokens: input.maxTokens
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
