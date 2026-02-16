import * as fs from 'fs'
import * as path from 'path'
import { loadConfig, resolveOutputContract } from '../utils/config'
import { callGemini } from '../utils/gemini'
import {
  findRelevantMemoryEntries,
  readMemoryEntries,
  saveMemoryEntry,
  type MemoryEntry
} from '../utils/memory'
import {
  inferTaskComplexity,
  loadSuccessPatterns,
  maybeRecomputeSuccessPatterns,
  type SuccessPattern,
  type TaskComplexity,
  updateSuccessPattern
} from '../utils/profile'
import {
  applyTelosUpdatesFromPrompt,
  buildTimeContext,
  detectRelevantProjects,
  ensureTelosGoal,
  loadTelosProfile,
  type TelosPreferences,
  type TelosProfile,
  type TelosProject,
  type TelosUpdateResult
} from '../utils/telos'
import { applyRatingToLatestHistory, createWorkItem } from '../utils/work'

interface BeforeAgentInput {
  prompt: string
  sessionId: string
  conversationHistory: Array<{ role: string; content: string }>
}

interface BeforeAgentOutput {
  modifiedPrompt: string
  injectedContext: string
  suggestedAgents: string[]
  systemInstructions: string
}

interface FeedbackSignal {
  rating: number
  feedbackText: string
  linkedIntent?: string
  linkedAgents?: string[]
  linkedProject?: string
  linkedComplexity?: TaskComplexity
}

interface AgentConstraints {
  include: string[]
  exclude: string[]
  only: boolean
}

interface HistoryEntryForScoring {
  intent?: string
  project?: string
  complexity?: string
  agents: string[]
  result?: string
  prompt?: string
  status?: string
  timestamp?: string
  rating?: number
  toolsUsed?: string[]
}

interface SimilarityContext {
  intent: string
  project?: string
  complexity: TaskComplexity
  toolsUsed: string[]
  prompt: string
}

interface SimilaritySignal {
  agentScoreBoost: Map<string, number>
  topCases: string[]
}

interface AgentScoringResult {
  rankedAgents: string[]
  scoreByAgent: Map<string, number>
}

interface DynamicCompositionResult {
  agents: string[]
  injectedAgents: string[]
  replacedBaselineAgents: string[]
}

const AGENT_COMPOSITION_POLICY = {
  maxAgents: 4,
  minBaseAgents: 1,
  replacementMinScore: 2,
  replacementDelta: 1,
  injectionMinScore: 1.2,
  minSimilarityBoost: 0.8,
  forceInjectionScore: 7.5
} as const

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

async function analyzeIntent(prompt: string): Promise<string> {
  const config = loadConfig()
  const template =
    config.prompts.intent_detection?.prompt ||
    'Analyze user request and return JSON: {"intent":"analysis"}. User request: {prompt}'
  const intentPrompt = template.replace('{prompt}', prompt)

  try {
    const response = await callGemini(intentPrompt, 0.3)
    const parsed = JSON.parse(response) as { intent?: string }
    return parsed.intent || 'analysis'
  } catch {
    return 'analysis'
  }
}

function selectAgentsByIntent(intent: string): string[] {
  const config = loadConfig()
  const mapping = config.agents.intentToAgents
  return mapping[intent] || ['engineer', 'analyst']
}

function availableAgentIds(): string[] {
  try {
    const config = loadConfig()
    return config.agents.agents.map((agent) => agent.id)
  } catch {
    return []
  }
}

function uniqueAgents(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))]
}

function parseKnownAgentsFromText(text: string, knownAgents: string[]): string[] {
  const knownMap = new Map(knownAgents.map((agent) => [agent.toLowerCase(), agent]))
  const tokens = (text.match(/[a-zA-Z][a-zA-Z0-9_-]*/g) || []).map((token) => token.toLowerCase())

  const parsed: string[] = []
  tokens.forEach((token) => {
    const matched = knownMap.get(token)
    if (matched && !parsed.includes(matched)) {
      parsed.push(matched)
    }
  })

  return parsed
}

function parseAgentConstraints(prompt: string, knownAgents: string[]): AgentConstraints {
  const lines = prompt
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const include: string[] = []
  const exclude: string[] = []
  let only = false

  const includePatterns: RegExp[] = [
    /^(?:本轮)?(?:包含|加入|使用|强制使用|force|include|use)\s*(?:agent|agents|角色)?(?:\s*[:：]\s*|\s+)(.+)$/i,
    /^(?:agent|agents)\s*[:：]\s*(.+)$/i
  ]
  const excludePatterns: RegExp[] = [
    /^(?:本轮)?(?:排除|移除|不要|不使用|exclude|without)\s*(?:agent|agents|角色)?(?:\s*[:：]\s*|\s+)(.+)$/i,
    /^(?:exclude|without)\s*(?:agent|agents)?(?:\s*[:：]\s*|\s+)(.+)$/i
  ]
  const onlyPatterns: RegExp[] = [
    /^(?:本轮)?(?:仅用|只用|只使用|only|only\s+use)\s*(?:agent|agents|角色)?(?:\s*[:：]\s*|\s+)(.+)$/i,
    /^(?:only)\s*(?:agent|agents)\s*[:：]\s*(.+)$/i
  ]

  lines.forEach((line) => {
    if (/(偏好|preferred)/i.test(line)) {
      return
    }

    const onlyMatch = onlyPatterns.map((pattern) => line.match(pattern)).find((match) => Boolean(match?.[1]))
    if (onlyMatch?.[1]) {
      const parsed = parseKnownAgentsFromText(onlyMatch[1], knownAgents)
      include.push(...parsed)
      only = parsed.length > 0
      return
    }

    const excludeMatch = excludePatterns
      .map((pattern) => line.match(pattern))
      .find((match) => Boolean(match?.[1]))
    if (excludeMatch?.[1]) {
      exclude.push(...parseKnownAgentsFromText(excludeMatch[1], knownAgents))
      return
    }

    const includeMatch = includePatterns
      .map((pattern) => line.match(pattern))
      .find((match) => Boolean(match?.[1]))
    if (includeMatch?.[1]) {
      include.push(...parseKnownAgentsFromText(includeMatch[1], knownAgents))
      return
    }

    // Shorthand: line like "researcher + writer + devil"
    if (/^[a-zA-Z0-9_+\-,\s]+$/.test(line) && line.includes('+')) {
      const parsed = parseKnownAgentsFromText(line, knownAgents)
      if (parsed.length >= 2) {
        include.push(...parsed)
      }
    }
  })

  return {
    include: uniqueAgents(include),
    exclude: uniqueAgents(exclude),
    only
  }
}

function hasAgentConstraints(constraints: AgentConstraints): boolean {
  return constraints.only || constraints.include.length > 0 || constraints.exclude.length > 0
}

function applyAgentConstraints(
  rankedAgents: string[],
  baseAgents: string[],
  constraints: AgentConstraints,
  knownAgents: string[]
): string[] {
  const excluded = new Set(constraints.exclude)
  const included = constraints.include.filter((agent) => !excluded.has(agent))

  if (constraints.only && included.length > 0) {
    return included.slice(0, 4)
  }

  let next = uniqueAgents(rankedAgents).filter((agent) => !excluded.has(agent))
  if (included.length > 0) {
    const rest = next.filter((agent) => !included.includes(agent))
    next = [...included, ...rest]
  }

  if (next.length === 0) {
    const baseFallback = uniqueAgents(baseAgents).filter((agent) => !excluded.has(agent))
    if (baseFallback.length > 0) {
      next = baseFallback
    }
  }

  if (next.length === 0) {
    const knownFallback = uniqueAgents(knownAgents).filter((agent) => !excluded.has(agent))
    if (knownFallback.length > 0) {
      next = knownFallback
    }
  }

  return next.slice(0, 4)
}

function detectRating(prompt: string): number | null {
  const patterns: RegExp[] = [
    /(?:评分|打分|rate|rating|score)\s*[:：]?\s*(10|[1-9])\b/i,
    /\b(10|[1-9])\s*\/\s*10\b/,
    /(?:^|\s)(10|[1-9])\s*分(?:\b|$)/
  ]

  for (const pattern of patterns) {
    const match = prompt.match(pattern)
    if (!match) {
      continue
    }

    const rating = Number(match[1])
    if (Number.isInteger(rating) && rating >= 1 && rating <= 10) {
      return rating
    }
  }

  return null
}

function normalizeTaskComplexity(value: unknown): TaskComplexity | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.toLowerCase().trim()
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }

  return undefined
}

function normalizeToolCombo(tools: string[] | undefined): string | undefined {
  const normalized = normalizeStringArray(tools).map((tool) => tool.toLowerCase())
  if (normalized.length === 0) {
    return undefined
  }

  return [...new Set(normalized)].sort().join(' + ')
}

function inferLikelyToolsFromPrompt(prompt: string): string[] {
  const text = prompt.toLowerCase()
  const tools = new Set<string>()

  if (/(run|exec|terminal|command|bash|shell|脚本|命令|测试|编译|build)/i.test(text)) {
    tools.add('shell')
  }
  if (/(code|file|repo|project|patch|diff|readme|typescript|javascript|python|文件|代码)/i.test(text)) {
    tools.add('filesystem')
  }
  if (/(search|news|latest|api doc|documentation|官网|文档|网页|网站|联网)/i.test(text)) {
    tools.add('web')
  }

  return [...tools]
}

function readTaggedValue(entry: MemoryEntry, prefix: string): string | undefined {
  const matched = entry.tags.find((tag) => tag.startsWith(prefix))
  if (!matched) {
    return undefined
  }

  const value = matched.slice(prefix.length).trim()
  return value || undefined
}

function getMetadataString(entry: MemoryEntry, key: string): string | undefined {
  const metadataValue = entry.metadata[key]
  if (typeof metadataValue === 'string' && metadataValue.trim().length > 0) {
    return metadataValue.trim()
  }
  return undefined
}

function getMetadataStringArray(entry: MemoryEntry, key: string): string[] | undefined {
  const metadataValue = entry.metadata[key]
  if (!Array.isArray(metadataValue)) {
    return undefined
  }

  const parsed = metadataValue
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (parsed.length === 0) {
    return undefined
  }

  return parsed
}

function normalizeProjectValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  return normalized || undefined
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return [...new Set(value)]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function readHistoryEntriesForScoring(gpaiDir: string): HistoryEntryForScoring[] {
  const filePath = path.join(gpaiDir, 'data/history.json')
  if (!fs.existsSync(filePath)) {
    return []
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const row = item as Record<string, unknown>
        const agents = normalizeStringArray(row.agents)
        if (agents.length === 0) {
          return null
        }

        const rating = typeof row.rating === 'number' && Number.isFinite(row.rating) ? row.rating : undefined
        return {
          intent: normalizeString(row.intent)?.toLowerCase(),
          project: normalizeString(row.project),
          complexity: normalizeTaskComplexity(row.complexity),
          agents,
          result: normalizeString(row.result),
          prompt: normalizeString(row.prompt),
          status: normalizeString(row.status)?.toLowerCase(),
          timestamp: normalizeString(row.timestamp),
          rating: typeof rating === 'number' ? Math.max(1, Math.min(10, rating)) : undefined,
          toolsUsed: normalizeStringArray(row.toolsUsed).map((tool) => tool.toLowerCase())
        } as HistoryEntryForScoring
      })
      .filter((item): item is HistoryEntryForScoring => Boolean(item))
  } catch {
    return []
  }
}

function tokenizeForSimilarity(text: string): Set<string> {
  const tokens = (text.toLowerCase().match(/[a-z0-9\u4e00-\u9fff_-]{2,}/g) || []).filter(
    (token) => token.length >= 2
  )
  return new Set(tokens)
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1
  }
  if (left.size === 0 || right.size === 0) {
    return 0
  }

  let overlap = 0
  left.forEach((token) => {
    if (right.has(token)) {
      overlap += 1
    }
  })

  const union = left.size + right.size - overlap
  if (union <= 0) {
    return 0
  }

  return overlap / union
}

function complexityLevel(complexity: TaskComplexity): number {
  switch (complexity) {
    case 'low':
      return 0
    case 'medium':
      return 1
    case 'high':
      return 2
    default:
      return 1
  }
}

function scoreComplexitySimilarity(
  entryComplexity: string | undefined,
  contextComplexity: TaskComplexity
): number {
  const normalized = normalizeTaskComplexity(entryComplexity)
  if (!normalized) {
    return 0.45
  }

  if (normalized === contextComplexity) {
    return 1
  }

  const distance = Math.abs(complexityLevel(normalized) - complexityLevel(contextComplexity))
  if (distance <= 1) {
    return 0.6
  }

  return 0.25
}

function scoreToolSimilarity(contextTools: string[], entryTools: string[]): number {
  const left = new Set(normalizeStringArray(contextTools).map((tool) => tool.toLowerCase()))
  const right = new Set(normalizeStringArray(entryTools).map((tool) => tool.toLowerCase()))

  if (left.size === 0 && right.size === 0) {
    return 0.4
  }
  if (left.size === 0 || right.size === 0) {
    return 0.25
  }

  return jaccardSimilarity(left, right)
}

function scoreTextSimilarity(contextPromptTokens: Set<string>, entry: HistoryEntryForScoring): number {
  const sourceText = `${entry.prompt || ''} ${entry.result || ''}`.trim()
  if (!sourceText) {
    return 0.2
  }

  const sourceTokens = tokenizeForSimilarity(sourceText)
  if (sourceTokens.size === 0) {
    return 0.2
  }

  return jaccardSimilarity(contextPromptTokens, sourceTokens)
}

function scoreOutcomeSignal(entry: HistoryEntryForScoring): number {
  if (typeof entry.rating === 'number' && Number.isFinite(entry.rating)) {
    const bounded = Math.max(1, Math.min(10, entry.rating))
    return (bounded - 5.5) / 4.5
  }

  if (entry.status === 'completed') {
    return 0.35
  }

  if (entry.status === 'failed') {
    return -0.55
  }

  return 0
}

function scoreRecencyWeight(timestamp?: string): number {
  if (!timestamp) {
    return 0.65
  }

  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) {
    return 0.65
  }

  const days = Math.max(0, (Date.now() - parsed) / (1000 * 60 * 60 * 24))
  return Math.pow(0.5, days / 45)
}

function buildSimilaritySignal(
  context: SimilarityContext,
  entries: HistoryEntryForScoring[],
  knownAgents: string[]
): SimilaritySignal {
  if (entries.length === 0) {
    return {
      agentScoreBoost: new Map<string, number>(),
      topCases: []
    }
  }

  const knownAgentSet = new Set(knownAgents)
  const contextIntent = normalizeString(context.intent)?.toLowerCase() || 'analysis'
  const contextProject = normalizeProjectValue(context.project)
  const contextTools = normalizeStringArray(context.toolsUsed).map((tool) => tool.toLowerCase())
  const contextPromptTokens = tokenizeForSimilarity(context.prompt)
  const boosts = new Map<string, number>()
  const caseSignals: Array<{
    entry: HistoryEntryForScoring
    similarity: number
    contribution: number
  }> = []

  entries.forEach((entry) => {
    const entryIntent = normalizeString(entry.intent)?.toLowerCase()
    const sameIntent = !entryIntent || entryIntent === contextIntent
    const intentSimilarity = !entryIntent ? 0.25 : sameIntent ? 1 : 0.08
    const entryProject = normalizeProjectValue(entry.project)
    let projectSimilarity = 0.35
    if (entryProject && contextProject) {
      projectSimilarity = entryProject === contextProject ? 1 : 0.05
    } else if (entryProject || contextProject) {
      projectSimilarity = 0.25
    }
    if (!sameIntent) {
      projectSimilarity = Math.min(projectSimilarity, 0.2)
    }

    const complexitySimilarity = scoreComplexitySimilarity(entry.complexity, context.complexity)
    const toolSimilarity = scoreToolSimilarity(contextTools, entry.toolsUsed || [])
    const textSimilarity = scoreTextSimilarity(contextPromptTokens, entry)
    let similarity =
      intentSimilarity * 0.35 +
      projectSimilarity * 0.2 +
      complexitySimilarity * 0.15 +
      toolSimilarity * 0.15 +
      textSimilarity * 0.15
    if (!sameIntent) {
      similarity *= 0.55
    }

    if (similarity < 0.22) {
      return
    }

    const outcomeSignal = scoreOutcomeSignal(entry)
    if (Math.abs(outcomeSignal) < 0.01) {
      return
    }

    const recencyWeight = scoreRecencyWeight(entry.timestamp)
    const rawContribution = similarity * outcomeSignal * recencyWeight * 4.5
    const contribution = Math.max(-4, Math.min(4, rawContribution))
    if (Math.abs(contribution) < 0.15) {
      return
    }

    const validAgents = uniqueAgents(entry.agents).filter((agent) =>
      knownAgentSet.size > 0 ? knownAgentSet.has(agent) : true
    )
    if (validAgents.length === 0) {
      return
    }

    const perAgentContribution = contribution / Math.max(1, Math.sqrt(validAgents.length))
    validAgents.forEach((agent) => {
      boosts.set(agent, (boosts.get(agent) || 0) + perAgentContribution)
    })

    caseSignals.push({
      entry: {
        ...entry,
        agents: validAgents
      },
      similarity,
      contribution
    })
  })

  const topCases = caseSignals
    .sort((a, b) => {
      const contributionDelta = Math.abs(b.contribution) - Math.abs(a.contribution)
      if (Math.abs(contributionDelta) > 0.001) {
        return contributionDelta
      }

      return b.similarity - a.similarity
    })
    .slice(0, 3)
    .map((signal) => {
      const entry = signal.entry
      const parsedTimestamp = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN
      const date = Number.isNaN(parsedTimestamp)
        ? 'unknown-date'
        : new Date(parsedTimestamp).toISOString().slice(0, 10)
      const influence =
        signal.contribution >= 0 ? `+${signal.contribution.toFixed(2)}` : signal.contribution.toFixed(2)
      const contextParts: string[] = []

      if (entry.intent) {
        contextParts.push(`intent=${entry.intent}`)
      }
      if (entry.project) {
        contextParts.push(`project=${entry.project}`)
      }
      if (entry.complexity) {
        contextParts.push(`complexity=${entry.complexity}`)
      }
      const combo = normalizeToolCombo(entry.toolsUsed)
      if (combo) {
        contextParts.push(`tools=${combo}`)
      }

      const contextLabel = contextParts.length > 0 ? ` (${contextParts.join(', ')})` : ''
      return `${date} | sim=${signal.similarity.toFixed(2)} | influence=${influence} | agents=${entry.agents.join(
        ' + '
      )}${contextLabel}`
    })

  return {
    agentScoreBoost: boosts,
    topCases
  }
}

function captureFeedbackSignal(gpaiDir: string, prompt: string, sessionId: string): FeedbackSignal | null {
  const rating = detectRating(prompt)
  if (!rating) {
    return null
  }

  const linked = applyRatingToLatestHistory(gpaiDir, {
    sessionId,
    rating,
    feedback: prompt
  })

  saveMemoryEntry(gpaiDir, 'warm', {
    type: 'feedback',
    sessionId,
    intent: linked?.intent,
    agents: linked?.agents || [],
    content: prompt,
    rating,
    tags: ['feedback', 'rating'],
    source: 'before-agent',
    metadata: {
      linkedWorkItemId: linked?.workItemId,
      linkedIntent: linked?.intent,
      linkedAgents: linked?.agents || [],
      linkedProject: linked?.project,
      linkedComplexity: linked?.complexity,
      linkedToolsUsed: linked?.toolsUsed || []
    }
  })

  if (linked?.intent && linked?.agents?.length) {
    updateSuccessPattern(gpaiDir, {
      task: linked.intent,
      agents: linked.agents,
      rating,
      toolsUsed: linked.toolsUsed,
      project: linked.project,
      complexity: normalizeTaskComplexity(linked.complexity),
      intent: linked.intent
    })
  }

  const recomputeResult = maybeRecomputeSuccessPatterns(gpaiDir)
  if (recomputeResult.triggered) {
    saveMemoryEntry(gpaiDir, 'warm', {
      type: 'learning_event',
      sessionId,
      intent: linked?.intent,
      agents: linked?.agents || [],
      content: `Success pattern recompute triggered (${recomputeResult.reason})`,
      tags: ['learning', 'success-pattern', 'recompute'],
      source: 'before-agent',
      metadata: {
        ...recomputeResult
      }
    })
  }

  return {
    rating,
    feedbackText: prompt,
    linkedIntent: linked?.intent,
    linkedAgents: linked?.agents,
    linkedProject: linked?.project,
    linkedComplexity: normalizeTaskComplexity(linked?.complexity)
  }
}

function parsePatternAgents(method: string): string[] {
  return method
    .split(/\+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function scoreAgents(
  intent: string,
  context: {
    project?: string
    complexity: TaskComplexity
    toolCombo?: string
  },
  baseAgents: string[],
  profilePreferredAgents: string[],
  memoryEntries: MemoryEntry[],
  successPatterns: SuccessPattern[],
  similarityBoost?: Map<string, number>
): AgentScoringResult {
  const score = new Map<string, number>()
  const ratedEntries = memoryEntries.filter(
    (entry): entry is MemoryEntry & { rating: number } =>
      typeof entry.rating === 'number' && entry.agents.length > 0
  )

  const patternAgentsByIntent = successPatterns
    .filter((pattern) => pattern.task === intent)
    .flatMap((pattern) => parsePatternAgents(pattern.method))

  const allCandidates = new Set<string>([...baseAgents, ...patternAgentsByIntent])
  ratedEntries.forEach((entry) => entry.agents.forEach((agent) => allCandidates.add(agent)))
  similarityBoost?.forEach((_boost, agent) => allCandidates.add(agent))

  allCandidates.forEach((agent) => score.set(agent, 0))

  profilePreferredAgents.forEach((agent) => {
    if (allCandidates.has(agent)) {
      score.set(agent, (score.get(agent) || 0) + 1.5)
    }
  })

  ratedEntries.forEach((entry) => {
    let weight = entry.rating - 5.5
    if (entry.intent === intent) {
      weight *= 1.4
    } else if (entry.intent && entry.intent !== intent) {
      weight *= 0.5
    }

    if (entry.type === 'feedback') {
      weight *= 1.5
    }

    const entryProject = normalizeProjectValue(
      getMetadataString(entry, 'linkedProject') ||
        getMetadataString(entry, 'project') ||
        readTaggedValue(entry, 'project:')
    )
    const contextProject = normalizeProjectValue(context.project)
    if (entryProject && contextProject) {
      weight *= entryProject === contextProject ? 1.35 : 0.7
    }

    const entryComplexity =
      normalizeTaskComplexity(getMetadataString(entry, 'linkedComplexity')) ||
      normalizeTaskComplexity(getMetadataString(entry, 'complexity')) ||
      normalizeTaskComplexity(readTaggedValue(entry, 'complexity:'))
    if (entryComplexity) {
      weight *= entryComplexity === context.complexity ? 1.25 : 0.8
    }

    const entryToolCombo = normalizeToolCombo(
      getMetadataStringArray(entry, 'toolsUsed') || getMetadataStringArray(entry, 'linkedToolsUsed')
    )
    if (entryToolCombo && context.toolCombo) {
      weight *= entryToolCombo === context.toolCombo ? 1.2 : 0.85
    }

    entry.agents.forEach((agent) => {
      score.set(agent, (score.get(agent) || 0) + weight)
    })
  })

  successPatterns.forEach((pattern) => {
    const agents = parsePatternAgents(pattern.method)
    if (agents.length === 0) {
      return
    }

    let patternWeight = (pattern.successRate - 0.5) * 6
    if (pattern.task === intent) {
      patternWeight *= 1.5
    } else {
      patternWeight *= 0.4
    }

    const patternProject = normalizeProjectValue(pattern.project)
    const contextProject = normalizeProjectValue(context.project)
    if (patternProject && contextProject) {
      patternWeight *= patternProject === contextProject ? 1.4 : 0.65
    } else if (patternProject && !contextProject) {
      patternWeight *= 0.9
    }

    if (pattern.complexity) {
      patternWeight *= pattern.complexity === context.complexity ? 1.25 : 0.8
    }

    if (pattern.toolCombo && context.toolCombo) {
      patternWeight *= pattern.toolCombo === context.toolCombo ? 1.2 : 0.85
    }

    if (typeof pattern.sampleSize === 'number') {
      const confidence = Math.min(1.5, 0.5 + Math.log10(Math.max(1, pattern.sampleSize)))
      patternWeight *= confidence
    }

    agents.forEach((agent) => {
      if (!allCandidates.has(agent) && pattern.task === intent && pattern.successRate >= 0.75) {
        allCandidates.add(agent)
        score.set(agent, 0)
      }

      if (allCandidates.has(agent)) {
        score.set(agent, (score.get(agent) || 0) + patternWeight)
      }
    })
  })

  similarityBoost?.forEach((boost, agent) => {
    if (!allCandidates.has(agent)) {
      allCandidates.add(agent)
      score.set(agent, 0)
    }

    score.set(agent, (score.get(agent) || 0) + boost)
  })

  const baseOrder = new Map(baseAgents.map((agent, index) => [agent, index]))
  const sortedBase = [...new Set(baseAgents)].sort((a, b) => {
    const diff = (score.get(b) || 0) - (score.get(a) || 0)
    if (Math.abs(diff) > 0.001) {
      return diff
    }

    return (baseOrder.get(a) || 0) - (baseOrder.get(b) || 0)
  })

  const extra = [...allCandidates]
    .filter((agent) => !sortedBase.includes(agent))
    .filter((agent) => (score.get(agent) || 0) > 2)
    .sort((a, b) => (score.get(b) || 0) - (score.get(a) || 0))

  const rankedAgents = uniqueAgents([...sortedBase, ...extra, ...allCandidates]).sort((a, b) => {
    const diff = (score.get(b) || 0) - (score.get(a) || 0)
    if (Math.abs(diff) > 0.001) {
      return diff
    }

    const baseDiff = (baseOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (baseOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
    if (baseDiff !== 0) {
      return baseDiff
    }

    return a.localeCompare(b)
  })

  return {
    rankedAgents,
    scoreByAgent: score
  }
}

function composeDynamicAgents(
  scoring: AgentScoringResult,
  baseAgents: string[],
  knownAgents: string[],
  similarityBoost?: Map<string, number>
): DynamicCompositionResult {
  const knownSet = new Set(knownAgents)
  const baseSet = new Set(uniqueAgents(baseAgents))
  const baselineAnchor = uniqueAgents(baseAgents)[0]
  const score = scoring.scoreByAgent
  const fallbackRanked = scoring.rankedAgents.filter((agent) =>
    knownSet.size > 0 ? knownSet.has(agent) : true
  )

  const baseline = uniqueAgents(baseAgents)
    .filter((agent) => (knownSet.size > 0 ? knownSet.has(agent) : true))
    .sort((a, b) => {
      const diff = (score.get(b) || 0) - (score.get(a) || 0)
      if (Math.abs(diff) > 0.001) {
        return diff
      }
      return baseAgents.indexOf(a) - baseAgents.indexOf(b)
    })
    .slice(0, AGENT_COMPOSITION_POLICY.maxAgents)

  const selected = [...baseline]
  const injected = new Set<string>()
  const replaced = new Set<string>()
  const candidateQueue = fallbackRanked.filter(
    (agent) => {
      if (baseSet.has(agent) || selected.includes(agent)) {
        return false
      }

      const candidateScore = score.get(agent) || 0
      if (candidateScore < AGENT_COMPOSITION_POLICY.injectionMinScore) {
        return false
      }

      const similarity = similarityBoost?.get(agent) || 0
      if (candidateScore >= AGENT_COMPOSITION_POLICY.forceInjectionScore) {
        return true
      }

      return similarity >= AGENT_COMPOSITION_POLICY.minSimilarityBoost
    }
  )

  const sortSelectedByScoreAsc = (): number[] =>
    selected
      .map((agent, index) => ({
        index,
        agent,
        score: score.get(agent) || 0
      }))
      .sort((a, b) => a.score - b.score)
      .map((item) => item.index)

  candidateQueue.forEach((candidate) => {
    const candidateScore = score.get(candidate) || 0
    if (candidateScore < AGENT_COMPOSITION_POLICY.replacementMinScore) {
      return
    }

    if (selected.length < AGENT_COMPOSITION_POLICY.maxAgents) {
      selected.push(candidate)
      injected.add(candidate)
      return
    }

    const baseCount = selected.filter((agent) => baseSet.has(agent)).length
    const replaceIndex = sortSelectedByScoreAsc().find((index) => {
      const existing = selected[index]
      const existingScore = score.get(existing) || 0
      const replacingBase = baseSet.has(existing)

      if (existing === baselineAnchor) {
        return false
      }

      if (replacingBase && baseCount <= AGENT_COMPOSITION_POLICY.minBaseAgents) {
        return false
      }

      return candidateScore >= existingScore + AGENT_COMPOSITION_POLICY.replacementDelta
    })

    if (typeof replaceIndex !== 'number') {
      return
    }

    const removed = selected[replaceIndex]
    selected[replaceIndex] = candidate
    injected.add(candidate)
    if (baseSet.has(removed)) {
      replaced.add(removed)
    }
  })

  if (selected.length === 0) {
    const fallback = fallbackRanked.slice(0, AGENT_COMPOSITION_POLICY.maxAgents)
    return {
      agents: fallback,
      injectedAgents: [],
      replacedBaselineAgents: []
    }
  }

  const baseCount = selected.filter((agent) => baseSet.has(agent)).length
  if (baseCount < AGENT_COMPOSITION_POLICY.minBaseAgents) {
    const strongestBase = baseline[0]
    if (strongestBase) {
      const weakestIndex = selected
        .map((agent, index) => ({
          index,
          score: score.get(agent) || 0,
          isBase: baseSet.has(agent)
        }))
        .filter((item) => !item.isBase)
        .sort((a, b) => a.score - b.score)[0]?.index

      if (typeof weakestIndex === 'number') {
        selected[weakestIndex] = strongestBase
      } else if (selected.length < AGENT_COMPOSITION_POLICY.maxAgents) {
        selected.push(strongestBase)
      }
    }
  }

  const ordered = uniqueAgents(selected).sort((a, b) => {
    const diff = (score.get(b) || 0) - (score.get(a) || 0)
    if (Math.abs(diff) > 0.001) {
      return diff
    }
    return a.localeCompare(b)
  })

  return {
    agents: ordered.slice(0, AGENT_COMPOSITION_POLICY.maxAgents),
    injectedAgents: [...injected],
    replacedBaselineAgents: [...replaced]
  }
}

function retrieveRelevantMemory(gpaiDir: string, prompt: string, intent: string): string {
  const queryMatches = findRelevantMemoryEntries(gpaiDir, {
    query: prompt,
    tiers: ['hot', 'warm'],
    limit: 5
  })

  const topRatedMatches = findRelevantMemoryEntries(gpaiDir, {
    intent,
    minRating: 8,
    tiers: ['warm'],
    limit: 3
  })

  const merged = [...queryMatches]
  topRatedMatches.forEach((entry) => {
    if (!merged.some((item) => item.id === entry.id)) {
      merged.push(entry)
    }
  })

  return merged
    .slice(0, 5)
    .map((entry) => {
      const ratingLabel = typeof entry.rating === 'number' ? ` | Rating: ${entry.rating}` : ''
      const agentsLabel = entry.agents.length > 0 ? ` | Agents: ${entry.agents.join(', ')}` : ''
      return `- ${entry.content}${ratingLabel}${agentsLabel}`
    })
    .join('\n')
}

function buildPreferenceSummary(
  intent: string,
  taskComplexity: TaskComplexity,
  toolCombo: string | undefined,
  agentConstraints: AgentConstraints,
  profile: TelosProfile,
  suggestedAgents: string[],
  composition: DynamicCompositionResult,
  feedbackSignal: FeedbackSignal | null,
  memoryEntries: MemoryEntry[],
  successPatterns: SuccessPattern[],
  similaritySignal: SimilaritySignal,
  relatedProjects: TelosProject[],
  telosUpdate: TelosUpdateResult,
  implicitGoalAdded: boolean
): string {
  const lines: string[] = []
  const profilePreferredAgents = profile.preferences.preferredAgents

  if (profilePreferredAgents.length > 0) {
    lines.push(`- Profile preferred agents: ${profilePreferredAgents.join(', ')}`)
  }

  const goals = profile.goals.slice(0, 2)
  if (goals.length > 0) {
    lines.push(`- Current goals: ${goals.join(' | ')}`)
  }

  lines.push(`- Estimated task complexity: ${taskComplexity}`)
  if (toolCombo) {
    lines.push(`- Likely tool combination: ${toolCombo}`)
  }

  if (hasAgentConstraints(agentConstraints)) {
    if (agentConstraints.only) {
      lines.push(`- Agent override (only): ${agentConstraints.include.join(', ')}`)
    } else {
      if (agentConstraints.include.length > 0) {
        lines.push(`- Agent override (include): ${agentConstraints.include.join(', ')}`)
      }
      if (agentConstraints.exclude.length > 0) {
        lines.push(`- Agent override (exclude): ${agentConstraints.exclude.join(', ')}`)
      }
    }
  }

  if (relatedProjects.length > 0) {
    lines.push(
      `- Related projects: ${relatedProjects
        .map((project) => `${project.name}(${project.status}/${project.priority})`)
        .join(', ')}`
    )
  }

  const strategies = profile.strategies.slice(0, 2)
  if (strategies.length > 0) {
    lines.push(`- Preferred strategies: ${strategies.join(' | ')}`)
  }

  const highRated = memoryEntries
    .filter((entry) => typeof entry.rating === 'number' && entry.rating >= 8)
    .slice(0, 2)

  highRated.forEach((entry) => {
    const intentLabel = entry.intent ? ` (${entry.intent})` : ''
    const agentsLabel = entry.agents.length > 0 ? ` -> ${entry.agents.join(', ')}` : ''
    lines.push(`- High-rated memory${intentLabel}: ${entry.rating}${agentsLabel}`)
  })

  const strongPatterns = successPatterns
    .filter((pattern) => pattern.task === intent && pattern.successRate >= 0.75)
    .slice(0, 2)

  strongPatterns.forEach((pattern) => {
    const patternContext: string[] = []
    if (pattern.project) {
      patternContext.push(`project=${pattern.project}`)
    }
    if (pattern.complexity) {
      patternContext.push(`complexity=${pattern.complexity}`)
    }
    if (pattern.toolCombo) {
      patternContext.push(`tools=${pattern.toolCombo}`)
    }
    const contextLabel = patternContext.length > 0 ? ` | ${patternContext.join(', ')}` : ''
    lines.push(
      `- Success pattern: ${pattern.method} (rate ${Math.round(pattern.successRate * 100)}%${contextLabel})`
    )
  })

  const similarityBoostPreview = [...similaritySignal.agentScoreBoost.entries()]
    .filter(([, boost]) => Math.abs(boost) >= 0.35)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([agent, boost]) => `${agent}(${boost >= 0 ? '+' : ''}${boost.toFixed(2)})`)

  if (similarityBoostPreview.length > 0) {
    lines.push(`- Context similarity boost: ${similarityBoostPreview.join(', ')}`)
  }

  similaritySignal.topCases.forEach((caseLine) => {
    lines.push(`- Context-similar case: ${caseLine}`)
  })

  if (composition.injectedAgents.length > 0) {
    lines.push(`- Dynamic composition injected: ${composition.injectedAgents.join(', ')}`)
  }
  if (composition.replacedBaselineAgents.length > 0) {
    lines.push(`- Dynamic composition replaced baseline: ${composition.replacedBaselineAgents.join(', ')}`)
  }

  if (feedbackSignal) {
    lines.push(`- Fresh feedback captured in this turn: rating ${feedbackSignal.rating}/10`)
    if (feedbackSignal.linkedProject) {
      lines.push(`- Feedback linked project: ${feedbackSignal.linkedProject}`)
    }
    if (feedbackSignal.linkedComplexity) {
      lines.push(`- Feedback linked complexity: ${feedbackSignal.linkedComplexity}`)
    }
  }

  if (telosUpdate.updated && telosUpdate.fields.length > 0) {
    lines.push(`- TELOS updated from this request: ${telosUpdate.fields.join(', ')}`)
  }

  if (implicitGoalAdded) {
    lines.push('- TELOS goal auto-expanded based on current task intent')
  }

  lines.push(`- Final recommended team for ${intent}: ${suggestedAgents.join(', ')}`)

  return lines.join('\n')
}

function inferGoalFromIntent(intent: string): string {
  switch (intent) {
    case 'security':
      return '持续提升系统安全性与风险可见性'
    case 'technical':
      return '持续提高工程质量与交付稳定性'
    case 'research':
      return '建立可复用的调研与证据沉淀流程'
    case 'strategy':
      return '形成可执行并可验证的决策方案'
    case 'creative':
      return '探索高质量创意并快速验证可行性'
    default:
      return '持续提升问题分析与执行效果'
  }
}

function generateSystemInstructions(
  agents: string[],
  intent: string,
  preferenceSummary: string
): string {
  const config = loadConfig()
  const outputContract = resolveOutputContract(config.prompts)
  const agentPrompts = agents
    .map((agentId) => {
      const agent = config.agents.agents.find((item) => item.id === agentId)
      if (!agent) {
        return ''
      }

      return `${agent.name} (${agent.role}):\n${agent.systemPrompt}`
    })
    .filter((line) => line.length > 0)
    .join('\n\n')

  return `You will now work as a team with these roles:

${agentPrompts}

Task Type: ${intent}

Preference Signals:
${preferenceSummary}

Output Contract (highest priority):
- Respond in ${outputContract.language}
- The first visible character must be ${outputContract.firstVisibleChar}
- Language check is relaxed (proper nouns in other languages are allowed as long as the configured language signal exists)

Process:
1. Each role analyzes independently
2. Share perspectives
3. Synthesize the best answer from all viewpoints
4. If in Council mode, use discussion format`
}

function buildModifiedPrompt(
  prompt: string,
  agents: string[],
  intent: string,
  complexity: TaskComplexity,
  toolCombo: string | undefined,
  agentConstraints: AgentConstraints,
  profile: TelosProfile,
  relatedProjects: TelosProject[]
): string {
  const timeContext = buildTimeContext(profile.preferences.timeZone)
  const outputContract = resolveOutputContract(loadConfig().prompts)
  const projectHint =
    relatedProjects.length > 0
      ? relatedProjects
          .map((project) => `${project.name}(${project.status}/${project.priority})`)
          .join(', ')
      : 'None'

  return `${prompt}

[System Guidance]
- Task Type: ${intent}
- Mission Anchor: ${profile.mission}
- Recommended Agents: ${agents.join(', ')}
- Related Projects: ${projectHint}
- Estimated Complexity: ${complexity}
- Likely Tools: ${toolCombo || 'not inferred'}
- Agent Constraints: ${
    hasAgentConstraints(agentConstraints)
      ? `include=${agentConstraints.include.join(', ') || 'none'}; exclude=${
          agentConstraints.exclude.join(', ') || 'none'
        }; only=${agentConstraints.only}`
      : 'none'
  }
- Time Zone: ${timeContext.timeZone}
- Relative Dates: today=${timeContext.today}, tomorrow=${timeContext.tomorrow}, yesterday=${timeContext.yesterday}
- Output Contract: language=${outputContract.language}; first visible character=${outputContract.firstVisibleChar}
- Use Council mode for multi-perspective analysis
- After completion, request user feedback (1-10 score)`
}

export async function handleBeforeAgent(input: BeforeAgentInput): Promise<BeforeAgentOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const knownAgentIds = availableAgentIds()
    const feedbackSignal = captureFeedbackSignal(gpaiDir, input.prompt, input.sessionId)
    const telosUpdate = applyTelosUpdatesFromPrompt(gpaiDir, input.prompt, {
      knownAgents: knownAgentIds
    })
    const intent = await analyzeIntent(input.prompt)
    const implicitGoal = inferGoalFromIntent(intent)
    const agentConstraints = parseAgentConstraints(input.prompt, knownAgentIds)

    const baseAgents = selectAgentsByIntent(intent)
    let profile = loadTelosProfile(gpaiDir)
    const implicitGoalAdded = ensureTelosGoal(gpaiDir, implicitGoal)
    if (telosUpdate.updated || implicitGoalAdded) {
      profile = loadTelosProfile(gpaiDir)
    }
    const profilePreferences: TelosPreferences = profile.preferences
    const relatedProjects = detectRelevantProjects(profile, input.prompt, 2)
    const likelyTools = inferLikelyToolsFromPrompt(input.prompt)
    const likelyToolCombo = normalizeToolCombo(likelyTools)
    const taskComplexity = inferTaskComplexity({
      prompt: input.prompt,
      toolsUsed: likelyTools,
      intent
    })
    const memoryForPreference = readMemoryEntries(gpaiDir, 'warm', 300)
      .concat(readMemoryEntries(gpaiDir, 'hot', 100))
      .filter((entry) => entry.type === 'feedback' || entry.type === 'task_result')
    const successPatterns = loadSuccessPatterns(gpaiDir)
    const historyEntries = readHistoryEntriesForScoring(gpaiDir)
    const similaritySignal = buildSimilaritySignal(
      {
        intent,
        project: relatedProjects[0]?.name,
        complexity: taskComplexity,
        toolsUsed: likelyTools,
        prompt: input.prompt
      },
      historyEntries,
      knownAgentIds
    )

    const scoring = scoreAgents(
      intent,
      {
        project: relatedProjects[0]?.name,
        complexity: taskComplexity,
        toolCombo: likelyToolCombo
      },
      baseAgents,
      profilePreferences.preferredAgents,
      memoryForPreference,
      successPatterns,
      similaritySignal.agentScoreBoost
    )
    const composition = composeDynamicAgents(
      scoring,
      baseAgents,
      knownAgentIds,
      similaritySignal.agentScoreBoost
    )
    const suggestedAgents = applyAgentConstraints(
      composition.agents,
      baseAgents,
      agentConstraints,
      knownAgentIds
    )

    createWorkItem(gpaiDir, {
      sessionId: input.sessionId,
      prompt: input.prompt,
      intent,
      agents: suggestedAgents,
      project: relatedProjects[0]?.name,
      complexity: taskComplexity
    })

    const relevantMemory = retrieveRelevantMemory(gpaiDir, input.prompt, intent)
    const preferenceSummary = buildPreferenceSummary(
      intent,
      taskComplexity,
      likelyToolCombo,
      agentConstraints,
      profile,
      suggestedAgents,
      composition,
      feedbackSignal,
      memoryForPreference,
      successPatterns,
      similaritySignal,
      relatedProjects,
      telosUpdate,
      implicitGoalAdded
    )

    const systemInstructions = generateSystemInstructions(suggestedAgents, intent, preferenceSummary)
    const modifiedPrompt = buildModifiedPrompt(
      input.prompt,
      suggestedAgents,
      intent,
      taskComplexity,
      likelyToolCombo,
      agentConstraints,
      profile,
      relatedProjects
    )

    return {
      modifiedPrompt,
      injectedContext: relevantMemory,
      suggestedAgents,
      systemInstructions
    }
  } catch {
    return {
      modifiedPrompt: input.prompt,
      injectedContext: '',
      suggestedAgents: ['engineer', 'analyst'],
      systemInstructions: ''
    }
  }
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}') as BeforeAgentInput
  handleBeforeAgent(input)
    .then((output) => {
      process.stdout.write(JSON.stringify(output))
      process.exit(0)
    })
    .catch((error: Error) => {
      process.stderr.write(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleBeforeAgent
