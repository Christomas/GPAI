import * as fs from 'fs'
import * as path from 'path'

export type MemoryTier = 'hot' | 'warm' | 'cold'

export interface MemoryEntry {
  id: string
  tier: MemoryTier
  type: string
  sessionId?: string
  intent?: string
  agents: string[]
  content: string
  rating?: number
  tags: string[]
  source: string
  timestamp: string
  metadata: Record<string, unknown>
}

export interface SaveMemoryInput {
  type: string
  content: string
  sessionId?: string
  intent?: string
  agents?: string[]
  rating?: number
  tags?: string[]
  source?: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

function memoryFilePath(gpaiDir: string, tier: MemoryTier): string {
  return path.join(gpaiDir, `data/memory/${tier}.jsonl`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toIsoTimestamp(input: unknown): string {
  if (typeof input === 'string' && input.trim().length > 0) {
    const date = new Date(input)
    if (!Number.isNaN(date.valueOf())) {
      return date.toISOString()
    }
  }

  if (typeof input === 'number' && Number.isFinite(input)) {
    const date = new Date(input)
    if (!Number.isNaN(date.valueOf())) {
      return date.toISOString()
    }
  }

  return new Date().toISOString()
}

function toAgentList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function toTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function generateMemoryId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeRating(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined
  }

  const bounded = Math.max(1, Math.min(10, Math.round(value)))
  return bounded
}

function extractMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(raw.metadata)) {
    return raw.metadata
  }
  return {}
}

function defaultContent(raw: Record<string, unknown>): string {
  const candidates = [raw.content, raw.resultSummary, raw.message, raw.result]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  try {
    return JSON.stringify(raw)
  } catch {
    return 'memory-entry'
  }
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

export function readJsonl(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    return []
  }

  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((entry) => entry !== null)
}

export function appendJsonl(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n')
}

export function normalizeMemoryEntry(rawValue: unknown, tier: MemoryTier): MemoryEntry | null {
  if (!isRecord(rawValue)) {
    return null
  }

  const metadata = extractMetadata(rawValue)
  const agents = toAgentList(rawValue.agents || metadata.agents)
  const tags = toTags(rawValue.tags)
  const rating = normalizeRating(rawValue.rating ?? metadata.rating)

  const sessionIdCandidate = rawValue.sessionId || metadata.sessionId
  const intentCandidate = rawValue.intent || metadata.intent

  return {
    id: safeString(rawValue.id, generateMemoryId()),
    tier,
    type: safeString(rawValue.type, 'note'),
    sessionId:
      typeof sessionIdCandidate === 'string' && sessionIdCandidate.trim().length > 0
        ? sessionIdCandidate
        : undefined,
    intent:
      typeof intentCandidate === 'string' && intentCandidate.trim().length > 0
        ? intentCandidate
        : undefined,
    agents,
    content: defaultContent(rawValue),
    rating,
    tags,
    source: safeString(rawValue.source, 'legacy'),
    timestamp: toIsoTimestamp(rawValue.timestamp),
    metadata
  }
}

export function createMemoryEntry(tier: MemoryTier, input: SaveMemoryInput): MemoryEntry {
  const metadata = isRecord(input.metadata) ? input.metadata : {}

  return {
    id: generateMemoryId(),
    tier,
    type: input.type,
    sessionId: input.sessionId,
    intent: input.intent,
    agents: input.agents || [],
    content: input.content,
    rating: normalizeRating(input.rating),
    tags: input.tags || [],
    source: input.source || 'system',
    timestamp: toIsoTimestamp(input.timestamp),
    metadata
  }
}

export function loadMemory(gpaiDir: string, tier: MemoryTier, limit: number): MemoryEntry[] {
  const filePath = memoryFilePath(gpaiDir, tier)
  const entries = readJsonl(filePath)
    .map((raw) => normalizeMemoryEntry(raw, tier))
    .filter((entry): entry is MemoryEntry => Boolean(entry))

  return entries.slice(-limit)
}

export function readMemoryEntries(gpaiDir: string, tier: MemoryTier, limit = 200): MemoryEntry[] {
  return loadMemory(gpaiDir, tier, limit)
}

export function saveToMemory(gpaiDir: string, tier: MemoryTier, entry: unknown): void {
  const filePath = memoryFilePath(gpaiDir, tier)

  const normalized = normalizeMemoryEntry(entry, tier)
  appendJsonl(filePath, normalized || entry)
}

export function saveMemoryEntry(gpaiDir: string, tier: MemoryTier, entry: SaveMemoryInput): MemoryEntry {
  const created = createMemoryEntry(tier, entry)
  appendJsonl(memoryFilePath(gpaiDir, tier), created)
  return created
}

export function findRelevantMemoryEntries(
  gpaiDir: string,
  input: {
    query?: string
    intent?: string
    minRating?: number
    tiers?: MemoryTier[]
    limit?: number
  }
): MemoryEntry[] {
  const tiers = input.tiers || ['hot', 'warm']
  const queryTokens = (input.query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2)

  const minRating = typeof input.minRating === 'number' ? input.minRating : undefined
  const limit = input.limit || 10

  const entries = tiers.flatMap((tier) => readMemoryEntries(gpaiDir, tier, 300))

  const filtered = entries.filter((entry) => {
    if (input.intent && entry.intent && entry.intent !== input.intent) {
      return false
    }

    if (typeof minRating === 'number') {
      if (typeof entry.rating !== 'number' || entry.rating < minRating) {
        return false
      }
    }

    if (queryTokens.length === 0) {
      return true
    }

    const haystack = `${entry.content} ${entry.tags.join(' ')}`.toLowerCase()
    return queryTokens.some((token) => haystack.includes(token))
  })

  return filtered
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit)
}
