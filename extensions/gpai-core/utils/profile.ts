import * as fs from 'fs'
import * as path from 'path'
import { ensureDir } from './memory'
import { resolveProfilePath } from './telos'

export interface SuccessPattern {
  task: string
  method: string
  successRate: number
  lastUsed: string
  sampleSize?: number
  toolCombo?: string
  project?: string
  complexity?: TaskComplexity
}

interface ProfileData {
  preferences?: {
    preferredAgents?: string[]
  }
  successPatterns?: SuccessPattern[]
  [key: string]: unknown
}

interface UpdateSuccessPatternInput {
  task: string
  agents: string[]
  success?: boolean
  rating?: number
  timestamp?: string
  toolsUsed?: string[]
  project?: string
  complexity?: TaskComplexity
  prompt?: string
  result?: string
  executionTime?: number
  modelCalls?: number
  intent?: string
}

interface PatternSignal {
  score: number
  weight: number
}

export type TaskComplexity = 'low' | 'medium' | 'high'

interface InferComplexityInput {
  prompt?: string
  result?: string
  toolsUsed?: string[]
  executionTime?: number
  modelCalls?: number
  intent?: string
}

interface HistoryEntryLike {
  intent?: string
  agents?: string[]
  status?: string
  timestamp?: string
  rating?: number
  project?: string
  complexity?: string
  toolsUsed?: string[]
  result?: string
  executionTime?: number
  modelCalls?: number
}

interface SuccessPatternRecomputeMeta {
  lastRunAt?: string
  lastHistoryCount: number
  lastRatedCount: number
  lastReason?: string
}

export interface SuccessPatternRecomputeResult {
  triggered: boolean
  reason: string
  historyCount: number
  ratedCount: number
  deltaHistory: number
  deltaRated: number
  updatedPatternCount: number
  runAt?: string
}

interface SuccessPatternRecomputePolicy {
  historyDeltaThreshold: number
  ratedDeltaThreshold: number
  minIntervalMs: number
  forceDeltaWithoutInterval: number
  maxPatterns: number
}

export const SUCCESS_PATTERN_RECOMPUTE_POLICY = {
  historyDeltaThreshold: 30,
  ratedDeltaThreshold: 10,
  minIntervalMs: 15 * 60 * 1000,
  forceDeltaWithoutInterval: 90,
  maxPatterns: 50
} as const

function readProfile(filePath: string): ProfileData {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ProfileData
    }
    return {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveLearningConfigPath(gpaiDir: string): string {
  const primary = path.join(gpaiDir, 'config/learning.json')
  const fallback = path.join(process.cwd(), 'config/learning.json')
  return fs.existsSync(primary) ? primary : fallback
}

function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const normalized = Math.floor(value)
  if (normalized < min || normalized > max) {
    return fallback
  }

  return normalized
}

function loadSuccessPatternRecomputePolicy(gpaiDir: string): SuccessPatternRecomputePolicy {
  const filePath = resolveLearningConfigPath(gpaiDir)
  const parsed = readJsonFile(filePath)
  const raw = isRecord(parsed) ? parsed : {}
  const section = isRecord(raw.successPatternRecompute) ? raw.successPatternRecompute : {}
  const defaultIntervalMinutes = Math.floor(SUCCESS_PATTERN_RECOMPUTE_POLICY.minIntervalMs / (60 * 1000))

  const historyDeltaThreshold = normalizeInteger(
    section.historyDeltaThreshold,
    SUCCESS_PATTERN_RECOMPUTE_POLICY.historyDeltaThreshold,
    1,
    10000
  )
  const ratedDeltaThreshold = normalizeInteger(
    section.ratedDeltaThreshold,
    SUCCESS_PATTERN_RECOMPUTE_POLICY.ratedDeltaThreshold,
    1,
    10000
  )
  const minIntervalMinutes = normalizeInteger(section.minIntervalMinutes, defaultIntervalMinutes, 1, 24 * 60)
  const forceDeltaWithoutInterval = normalizeInteger(
    section.forceDeltaWithoutInterval,
    historyDeltaThreshold * 3,
    historyDeltaThreshold,
    100000
  )
  const maxPatterns = normalizeInteger(
    section.maxPatterns,
    SUCCESS_PATTERN_RECOMPUTE_POLICY.maxPatterns,
    10,
    500
  )

  return {
    historyDeltaThreshold,
    ratedDeltaThreshold,
    minIntervalMs: minIntervalMinutes * 60 * 1000,
    forceDeltaWithoutInterval,
    maxPatterns
  }
}

function writeProfile(filePath: string, profile: ProfileData): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2))
}

function normalizeDate(input?: string): string {
  const parsed = input ? new Date(input) : new Date()
  if (Number.isNaN(parsed.valueOf())) {
    return new Date().toISOString()
  }
  return parsed.toISOString()
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5
  }

  if (value < 0) {
    return 0
  }

  if (value > 1) {
    return 1
  }

  return value
}

function roundRate(value: number): number {
  return Math.round(clampRate(value) * 1000) / 1000
}

function toMethod(agents: string[]): string {
  return agents
    .filter((agent) => typeof agent === 'string' && agent.trim().length > 0)
    .map((agent) => agent.trim())
    .join(' + ')
}

function normalizeToolCombo(value?: string[]): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }

  const normalized = [...new Set(value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))]
  if (normalized.length === 0) {
    return undefined
  }

  return normalized.sort().join(' + ')
}

function normalizeProject(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  return normalized
}

function normalizeComplexity(value?: string): TaskComplexity | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.toLowerCase().trim()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }

  return undefined
}

function textTokenCount(text: string): number {
  return text
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0).length
}

export function inferTaskComplexity(input: InferComplexityInput): TaskComplexity {
  let score = 0

  const text = `${input.prompt || ''} ${input.result || ''}`.trim()
  const tokens = textTokenCount(text)
  if (tokens >= 120) {
    score += 2
  } else if (tokens >= 60) {
    score += 1
  }

  const toolCount = Array.isArray(input.toolsUsed) ? input.toolsUsed.length : 0
  if (toolCount >= 4) {
    score += 2
  } else if (toolCount >= 2) {
    score += 1
  }

  const executionTime = typeof input.executionTime === 'number' ? input.executionTime : 0
  if (executionTime >= 5000) {
    score += 2
  } else if (executionTime >= 2000) {
    score += 1
  }

  const modelCalls = typeof input.modelCalls === 'number' ? input.modelCalls : 0
  if (modelCalls >= 6) {
    score += 2
  } else if (modelCalls >= 3) {
    score += 1
  }

  const intent = (input.intent || '').toLowerCase().trim()
  if (intent === 'strategy' || intent === 'research' || intent === 'security') {
    score += 1
  }

  if (score >= 6) {
    return 'high'
  }
  if (score >= 3) {
    return 'medium'
  }
  return 'low'
}

function getDaysBetween(previousIso: string, currentIso: string): number {
  const previous = new Date(previousIso)
  const current = new Date(currentIso)

  if (Number.isNaN(previous.valueOf()) || Number.isNaN(current.valueOf())) {
    return 0
  }

  const diffMs = Math.max(0, current.valueOf() - previous.valueOf())
  return diffMs / (1000 * 60 * 60 * 24)
}

function toSignal(input: UpdateSuccessPatternInput): PatternSignal | null {
  if (typeof input.rating === 'number' && Number.isFinite(input.rating)) {
    const bounded = Math.max(1, Math.min(10, input.rating))
    return {
      score: bounded / 10,
      weight: 0.45
    }
  }

  if (typeof input.success === 'boolean') {
    return {
      score: input.success ? 0.9 : 0.2,
      weight: 0.25
    }
  }

  return null
}

function readHistoryRows(gpaiDir: string): HistoryEntryLike[] {
  const filePath = path.join(gpaiDir, 'data/history.json')
  if (!fs.existsSync(filePath)) {
    return []
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is HistoryEntryLike => isRecord(item))
  } catch {
    return []
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  return undefined
}

function historySignal(row: HistoryEntryLike): PatternSignal | null {
  if (typeof row.rating === 'number' && Number.isFinite(row.rating)) {
    const bounded = Math.max(1, Math.min(10, row.rating))
    return {
      score: bounded / 10,
      weight: 0.45
    }
  }

  if (row.status === 'completed') {
    return {
      score: 0.9,
      weight: 0.25
    }
  }

  if (row.status === 'failed') {
    return {
      score: 0.2,
      weight: 0.25
    }
  }

  return null
}

function countRatedRows(rows: HistoryEntryLike[]): number {
  return rows.filter((row) => typeof row.rating === 'number' && Number.isFinite(row.rating)).length
}

function normalizeMetaCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function readRecomputeMeta(profile: ProfileData): SuccessPatternRecomputeMeta {
  const learningMeta = isRecord(profile.learningMeta) ? profile.learningMeta : {}
  const recomputeMeta = isRecord(learningMeta.successPatternRecompute)
    ? learningMeta.successPatternRecompute
    : {}

  return {
    lastRunAt: typeof recomputeMeta.lastRunAt === 'string' ? recomputeMeta.lastRunAt : undefined,
    lastHistoryCount: normalizeMetaCount(recomputeMeta.lastHistoryCount),
    lastRatedCount: normalizeMetaCount(recomputeMeta.lastRatedCount),
    lastReason: typeof recomputeMeta.lastReason === 'string' ? recomputeMeta.lastReason : undefined
  }
}

function writeRecomputeMeta(
  profile: ProfileData,
  input: {
    runAt: string
    historyCount: number
    ratedCount: number
    reason: string
  }
): ProfileData {
  const learningMeta = isRecord(profile.learningMeta) ? profile.learningMeta : {}
  const recomputeMeta = isRecord(learningMeta.successPatternRecompute)
    ? learningMeta.successPatternRecompute
    : {}

  return {
    ...profile,
    learningMeta: {
      ...learningMeta,
      successPatternRecompute: {
        ...recomputeMeta,
        lastRunAt: input.runAt,
        lastHistoryCount: input.historyCount,
        lastRatedCount: input.ratedCount,
        lastReason: input.reason
      }
    }
  }
}

function buildPatternKey(input: {
  task: string
  method: string
  toolCombo?: string
  project?: string
  complexity?: TaskComplexity
}): string {
  return `${input.task}|${input.method}|${input.toolCombo || ''}|${input.project || ''}|${input.complexity || ''}`
}

function recomputePatternsFromHistory(
  rows: HistoryEntryLike[],
  policy: SuccessPatternRecomputePolicy
): SuccessPattern[] {
  const sortedRows = [...rows].sort((a, b) => normalizeDate(a.timestamp).localeCompare(normalizeDate(b.timestamp)))
  const byKey = new Map<string, SuccessPattern>()

  sortedRows.forEach((row) => {
    const task = typeof row.intent === 'string' && row.intent.trim().length > 0 ? row.intent.trim() : 'analysis'
    const agents = normalizeStringArray(row.agents)
    const method = toMethod(agents)
    if (!method) {
      return
    }

    const signal = historySignal(row)
    if (!signal) {
      return
    }

    const timestamp = normalizeDate(row.timestamp)
    const toolsUsed = normalizeStringArray(row.toolsUsed)
    const toolCombo = normalizeToolCombo(toolsUsed)
    const project = normalizeProject(typeof row.project === 'string' ? row.project : undefined)
    const complexity =
      normalizeComplexity(typeof row.complexity === 'string' ? row.complexity : undefined) ||
      inferTaskComplexity({
        result: typeof row.result === 'string' ? row.result : undefined,
        toolsUsed,
        executionTime: normalizeNumber(row.executionTime),
        modelCalls: normalizeNumber(row.modelCalls),
        intent: task
      })

    const key = buildPatternKey({
      task,
      method,
      toolCombo,
      project,
      complexity
    })
    const current = byKey.get(key)

    if (!current) {
      byKey.set(key, {
        task,
        method,
        successRate: roundRate(signal.score),
        lastUsed: timestamp,
        sampleSize: 1,
        toolCombo,
        project,
        complexity
      })
      return
    }

    const daysSince = getDaysBetween(current.lastUsed, timestamp)
    const decay = Math.pow(0.985, daysSince)
    const decayedRate = 0.5 + (current.successRate - 0.5) * decay
    const nextRate = decayedRate * (1 - signal.weight) + signal.score * signal.weight

    byKey.set(key, {
      ...current,
      successRate: roundRate(nextRate),
      lastUsed: timestamp,
      sampleSize: (current.sampleSize || 1) + 1,
      toolCombo,
      project,
      complexity
    })
  })

  return [...byKey.values()]
    .sort((a, b) => {
      const rateDiff = b.successRate - a.successRate
      if (Math.abs(rateDiff) > 0.001) {
        return rateDiff
      }
      return b.lastUsed.localeCompare(a.lastUsed)
    })
    .slice(0, policy.maxPatterns)
}

export function loadSuccessPatterns(gpaiDir: string): SuccessPattern[] {
  const profilePath = resolveProfilePath(gpaiDir)
  const profile = readProfile(profilePath)

  if (!Array.isArray(profile.successPatterns)) {
    return []
  }

  return profile.successPatterns
    .filter((item): item is SuccessPattern => {
      return Boolean(
        item &&
          typeof item.task === 'string' &&
          typeof item.method === 'string' &&
          typeof item.successRate === 'number'
      )
    })
    .map((pattern) => ({
      ...pattern,
      successRate: clampRate(pattern.successRate),
      lastUsed: normalizeDate(pattern.lastUsed),
      sampleSize: typeof pattern.sampleSize === 'number' ? Math.max(1, pattern.sampleSize) : 1,
      toolCombo: typeof pattern.toolCombo === 'string' ? pattern.toolCombo : undefined,
      project: typeof pattern.project === 'string' ? pattern.project : undefined,
      complexity: normalizeComplexity(pattern.complexity)
    }))
}

export function updateSuccessPattern(gpaiDir: string, input: UpdateSuccessPatternInput): SuccessPattern | null {
  const method = toMethod(input.agents)
  if (!input.task || !method) {
    return null
  }

  const signal = toSignal(input)
  if (!signal) {
    return null
  }

  const now = normalizeDate(input.timestamp)
  const toolCombo = normalizeToolCombo(input.toolsUsed)
  const project = normalizeProject(input.project)
  const complexity =
    normalizeComplexity(input.complexity) ||
    inferTaskComplexity({
      prompt: input.prompt,
      result: input.result,
      toolsUsed: input.toolsUsed,
      executionTime: input.executionTime,
      modelCalls: input.modelCalls,
      intent: input.intent || input.task
    })
  const profilePath = resolveProfilePath(gpaiDir)
  const profile = readProfile(profilePath)
  const patterns = loadSuccessPatterns(gpaiDir)

  const existingIndex = patterns.findIndex(
    (pattern) =>
      pattern.task === input.task &&
      pattern.method === method &&
      (pattern.toolCombo || '') === (toolCombo || '') &&
      (pattern.project || '') === (project || '') &&
      (pattern.complexity || '') === (complexity || '')
  )

  let updated: SuccessPattern

  if (existingIndex >= 0) {
    const current = patterns[existingIndex]
    const daysSince = getDaysBetween(current.lastUsed, now)
    const decay = Math.pow(0.985, daysSince)
    const decayedRate = 0.5 + (current.successRate - 0.5) * decay
    const nextRate = decayedRate * (1 - signal.weight) + signal.score * signal.weight

    updated = {
      ...current,
      successRate: roundRate(nextRate),
      lastUsed: now,
      sampleSize: (current.sampleSize || 1) + 1,
      toolCombo,
      project,
      complexity
    }

    patterns[existingIndex] = updated
  } else {
    updated = {
      task: input.task,
      method,
      successRate: roundRate(signal.score),
      lastUsed: now,
      sampleSize: 1,
      toolCombo,
      project,
      complexity
    }

    patterns.push(updated)
  }

  patterns.sort((a, b) => {
    const rateDiff = b.successRate - a.successRate
    if (Math.abs(rateDiff) > 0.001) {
      return rateDiff
    }
    return b.lastUsed.localeCompare(a.lastUsed)
  })

  const trimmed = patterns.slice(0, 50)
  const nextProfile: ProfileData = {
    ...profile,
    successPatterns: trimmed
  }

  writeProfile(profilePath, nextProfile)
  return updated
}

function decideRecompute(
  counts: { historyCount: number; ratedCount: number },
  meta: SuccessPatternRecomputeMeta,
  nowIso: string,
  force: boolean,
  policy: SuccessPatternRecomputePolicy
): {
  shouldRun: boolean
  reason: string
  deltaHistory: number
  deltaRated: number
} {
  const deltaHistory = Math.max(0, counts.historyCount - meta.lastHistoryCount)
  const deltaRated = Math.max(0, counts.ratedCount - meta.lastRatedCount)
  const historyReset = counts.historyCount < meta.lastHistoryCount || counts.ratedCount < meta.lastRatedCount

  if (counts.historyCount === 0) {
    return {
      shouldRun: false,
      reason: 'empty-history',
      deltaHistory,
      deltaRated
    }
  }

  if (force) {
    return {
      shouldRun: true,
      reason: 'force',
      deltaHistory,
      deltaRated
    }
  }

  const lastRunMs = meta.lastRunAt ? Date.parse(meta.lastRunAt) : 0
  const nowMs = Date.parse(nowIso)
  const elapsedMs = Math.max(0, nowMs - (Number.isNaN(lastRunMs) ? 0 : lastRunMs))
  const intervalPassed = !meta.lastRunAt || elapsedMs >= policy.minIntervalMs

  if (deltaHistory >= policy.forceDeltaWithoutInterval) {
    return {
      shouldRun: true,
      reason: 'history-force-threshold',
      deltaHistory,
      deltaRated
    }
  }

  if (deltaRated >= policy.ratedDeltaThreshold * 3) {
    return {
      shouldRun: true,
      reason: 'rating-force-threshold',
      deltaHistory,
      deltaRated
    }
  }

  if (!intervalPassed) {
    return {
      shouldRun: false,
      reason: 'cooldown',
      deltaHistory,
      deltaRated
    }
  }

  if (historyReset) {
    return {
      shouldRun: true,
      reason: 'history-reset',
      deltaHistory,
      deltaRated
    }
  }

  if (deltaHistory >= policy.historyDeltaThreshold) {
    return {
      shouldRun: true,
      reason: 'history-threshold',
      deltaHistory,
      deltaRated
    }
  }

  if (deltaRated >= policy.ratedDeltaThreshold) {
    return {
      shouldRun: true,
      reason: 'rating-threshold',
      deltaHistory,
      deltaRated
    }
  }

  return {
    shouldRun: false,
    reason: 'threshold-not-met',
    deltaHistory,
    deltaRated
  }
}

export function maybeRecomputeSuccessPatterns(
  gpaiDir: string,
  options?: { force?: boolean; now?: Date }
): SuccessPatternRecomputeResult {
  const profilePath = resolveProfilePath(gpaiDir)
  const profile = readProfile(profilePath)
  const rows = readHistoryRows(gpaiDir)
  const historyCount = rows.length
  const ratedCount = countRatedRows(rows)
  const nowIso = normalizeDate(options?.now?.toISOString())
  const meta = readRecomputeMeta(profile)
  const policy = loadSuccessPatternRecomputePolicy(gpaiDir)
  const decision = decideRecompute(
    {
      historyCount,
      ratedCount
    },
    meta,
    nowIso,
    Boolean(options?.force),
    policy
  )

  if (!decision.shouldRun) {
    return {
      triggered: false,
      reason: decision.reason,
      historyCount,
      ratedCount,
      deltaHistory: decision.deltaHistory,
      deltaRated: decision.deltaRated,
      updatedPatternCount: Array.isArray(profile.successPatterns) ? profile.successPatterns.length : 0
    }
  }

  const recomputedPatterns = recomputePatternsFromHistory(rows, policy)
  const nextProfile = writeRecomputeMeta(
    {
      ...profile,
      successPatterns: recomputedPatterns
    },
    {
      runAt: nowIso,
      historyCount,
      ratedCount,
      reason: decision.reason
    }
  )

  writeProfile(profilePath, nextProfile)
  return {
    triggered: true,
    reason: decision.reason,
    historyCount,
    ratedCount,
    deltaHistory: decision.deltaHistory,
    deltaRated: decision.deltaRated,
    updatedPatternCount: recomputedPatterns.length,
    runAt: nowIso
  }
}
