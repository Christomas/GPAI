import * as fs from 'fs'
import * as path from 'path'
import { ensureDir } from './memory'
import type { TaskComplexity } from './profile'

export type WorkStatus = 'in-progress' | 'completed' | 'failed'

export interface WorkItemMeta {
  id: string
  sessionId: string
  prompt: string
  intent: string
  project?: string
  complexity?: TaskComplexity
  createdAt: string
  updatedAt: string
  status: WorkStatus
  agents: string[]
  execution?: {
    executionTime: number
    toolsUsed: string[]
    modelCalls: number
    success: boolean
    errorMessage?: string
  }
  resultSummary?: string
}

export interface HistoryEntry {
  sessionId: string
  intent: string
  project?: string
  complexity?: TaskComplexity
  agents: string[]
  result: string
  status: Exclude<WorkStatus, 'in-progress'>
  timestamp: string
  workItemId?: string
  toolsUsed?: string[]
  modelCalls?: number
  executionTime?: number
  rating?: number
  feedback?: string
}

interface FinalizeWorkInput {
  sessionId?: string
  success: boolean
  executionTime: number
  toolsUsed: string[]
  modelCalls: number
  errorMessage?: string
  resultSummary: string
}

interface WorkFileRef {
  metaPath: string
  workItem: WorkItemMeta
}

function normalizeComplexity(value: unknown): TaskComplexity | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.toLowerCase().trim()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }
  return undefined
}

function workRoot(gpaiDir: string): string {
  return path.join(gpaiDir, 'data/work')
}

function historyPath(gpaiDir: string): string {
  return path.join(gpaiDir, 'data/history.json')
}

function safeReadJson(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function safeWriteJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function readHistoryEntries(gpaiDir: string): HistoryEntry[] {
  const filePath = historyPath(gpaiDir)
  const parsed = safeReadJson(filePath)
  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.filter((item): item is HistoryEntry => Boolean(item && typeof item === 'object')) as HistoryEntry[]
}

function writeHistoryEntries(gpaiDir: string, entries: HistoryEntry[]): void {
  safeWriteJson(historyPath(gpaiDir), entries)
}

function toIsoNow(): string {
  return new Date().toISOString()
}

function compactTimestamp(): string {
  return toIsoNow().replace(/[:.]/g, '-')
}

function summarizeResult(result: string, maxLength = 300): string {
  const normalized = result.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 3)}...`
}

function parseWorkFile(metaPath: string): WorkItemMeta | null {
  const parsed = safeReadJson(metaPath)
  if (!parsed || typeof parsed !== 'object') {
    return null
  }

  const obj = parsed as Partial<WorkItemMeta>
  if (!obj.id || !obj.createdAt || !obj.status) {
    return null
  }

  return {
    id: obj.id,
    sessionId: obj.sessionId || 'unknown-session',
    prompt: obj.prompt || '',
    intent: obj.intent || 'analysis',
    project: typeof obj.project === 'string' ? obj.project : undefined,
    complexity: normalizeComplexity(obj.complexity),
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt || obj.createdAt,
    status: obj.status,
    agents: Array.isArray(obj.agents) ? obj.agents : [],
    execution: obj.execution,
    resultSummary: obj.resultSummary
  }
}

function listWorkFiles(gpaiDir: string): WorkFileRef[] {
  const root = workRoot(gpaiDir)
  if (!fs.existsSync(root)) {
    return []
  }

  const refs: WorkFileRef[] = []
  const entries = fs.readdirSync(root, { withFileTypes: true })

  entries.forEach((entry) => {
    if (!entry.isDirectory() || !entry.name.endsWith('_work')) {
      return
    }

    const metaPath = path.join(root, entry.name, 'META.json')
    const workItem = parseWorkFile(metaPath)
    if (!workItem) {
      return
    }

    refs.push({ metaPath, workItem })
  })

  refs.sort((a, b) => b.workItem.createdAt.localeCompare(a.workItem.createdAt))
  return refs
}

export function createWorkItem(
  gpaiDir: string,
  input: {
    sessionId: string
    prompt: string
    intent: string
    agents: string[]
    project?: string
    complexity?: TaskComplexity
  }
): WorkItemMeta {
  const id = compactTimestamp()
  const createdAt = toIsoNow()
  const meta: WorkItemMeta = {
    id,
    sessionId: input.sessionId,
    prompt: input.prompt,
    intent: input.intent,
    project: input.project,
    complexity: input.complexity,
    createdAt,
    updatedAt: createdAt,
    status: 'in-progress',
    agents: input.agents
  }

  const dirPath = path.join(workRoot(gpaiDir), `${id}_work`)
  ensureDir(dirPath)
  safeWriteJson(path.join(dirPath, 'META.json'), meta)
  return meta
}

export function finalizeLatestWorkItem(
  gpaiDir: string,
  input: FinalizeWorkInput
): WorkItemMeta | null {
  const refs = listWorkFiles(gpaiDir)
  if (refs.length === 0) {
    return null
  }

  let target = refs.find((ref) => {
    if (ref.workItem.status !== 'in-progress') {
      return false
    }

    if (input.sessionId) {
      return ref.workItem.sessionId === input.sessionId
    }

    return true
  })

  if (!target) {
    target = refs.find((ref) => {
      if (!input.sessionId) {
        return false
      }
      return ref.workItem.sessionId === input.sessionId
    })
  }

  if (!target) {
    return null
  }

  const now = toIsoNow()
  const updated: WorkItemMeta = {
    ...target.workItem,
    updatedAt: now,
    status: input.success ? 'completed' : 'failed',
    resultSummary: summarizeResult(input.resultSummary),
    execution: {
      executionTime: input.executionTime,
      toolsUsed: input.toolsUsed,
      modelCalls: input.modelCalls,
      success: input.success,
      errorMessage: input.errorMessage
    }
  }

  safeWriteJson(target.metaPath, updated)
  return updated
}

export function appendHistoryEntry(gpaiDir: string, entry: HistoryEntry): void {
  const history = readHistoryEntries(gpaiDir)
  history.push(entry)
  writeHistoryEntries(gpaiDir, history)
}

export function applyRatingToLatestHistory(
  gpaiDir: string,
  input: {
    sessionId?: string
    rating: number
    feedback: string
  }
): HistoryEntry | null {
  const history = readHistoryEntries(gpaiDir)
  if (history.length === 0) {
    return null
  }

  let targetIndex = -1
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i]
    if (item.status !== 'completed') {
      continue
    }

    if (typeof input.sessionId === 'string' && input.sessionId.length > 0) {
      if (item.sessionId !== input.sessionId) {
        continue
      }
    }

    targetIndex = i
    break
  }

  if (targetIndex < 0) {
    return null
  }

  const updated: HistoryEntry = {
    ...history[targetIndex],
    rating: input.rating,
    feedback: input.feedback
  }
  history[targetIndex] = updated
  writeHistoryEntries(gpaiDir, history)
  return updated
}
