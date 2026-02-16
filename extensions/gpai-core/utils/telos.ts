import * as fs from 'fs'
import * as path from 'path'

export interface TelosUser {
  name: string
  aiName: string
  email?: string
}

export interface TelosProject {
  name: string
  description: string
  status: string
  priority: string
}

export interface TelosPreferences {
  communicationStyle: string
  detailLevel?: string
  responseLength?: string
  preferredAgents: string[]
  councilMode: boolean
  learningEnabled: boolean
  timeZone: string
}

export interface TelosProfile {
  user: TelosUser
  mission: string
  goals: string[]
  projects: TelosProject[]
  beliefs: string[]
  models: string[]
  strategies: string[]
  learnings: string[]
  preferences: TelosPreferences
}

export interface TelosUpdateResult {
  updated: boolean
  fields: string[]
}

export interface TelosUpdateOptions {
  knownAgents?: string[]
}

export interface TimeContext {
  timeZone: string
  localNow: string
  today: string
  tomorrow: string
  yesterday: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNonEmptyString(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function toTrimmedString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  return fallback
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => toNonEmptyString(item))
    .filter((item) => item.length > 0)
}

function uniqueKeepOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []

  values.forEach((value) => {
    const normalized = value.trim()
    if (!normalized) {
      return
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    output.push(normalized)
  })

  return output
}

function splitCsvLike(value: string): string[] {
  return value
    .replace(/[，、；;]/g, ',')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function includesAnyTerm(text: string, terms: string[]): boolean {
  const lowerText = text.toLowerCase()
  return terms.some((term) => {
    if (!term) {
      return false
    }
    return lowerText.includes(term.toLowerCase())
  })
}

function normalizeProject(value: unknown): TelosProject | null {
  if (!isRecord(value)) {
    return null
  }

  const name = toNonEmptyString(value.name)
  if (!name) {
    return null
  }

  return {
    name,
    description: toNonEmptyString(value.description),
    status: toNonEmptyString(value.status, 'in-progress'),
    priority: toNonEmptyString(value.priority, 'medium')
  }
}

function normalizeProjects(value: unknown): TelosProject[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => normalizeProject(item)).filter((item): item is TelosProject => Boolean(item))
}

function parseProjectSpec(value: string, fallbackName = ''): TelosProject | null {
  const parts = value
    .split(/[|｜]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  const name = parts[0] || fallbackName
  if (!name) {
    return null
  }

  return {
    name,
    description: parts[1] || '',
    status: parts[2] || 'in-progress',
    priority: parts[3] || 'medium'
  }
}

function parseProjectValues(value: string): TelosProject[] {
  const normalized = value.replace(/[；]/g, ';')
  const segments = normalized.includes(';')
    ? normalized
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    : [normalized]

  const parsed: TelosProject[] = []
  segments.forEach((segment) => {
    if (segment.includes('|') || segment.includes('｜')) {
      const project = parseProjectSpec(segment)
      if (project) {
        parsed.push(project)
      }
      return
    }

    splitCsvLike(segment).forEach((name) => {
      const project = parseProjectSpec(name)
      if (project) {
        parsed.push(project)
      }
    })
  })

  return parsed
}

function normalizeAgentList(values: string[]): string[] {
  return uniqueKeepOrder(
    values
      .map((item) => item.toLowerCase())
      .filter((item) => /^[a-z][a-z0-9_-]*$/.test(item))
  )
}

function parseAgentsFromText(value: string, knownAgents: string[]): string[] {
  const tokens = normalizeAgentList((value.match(/[a-zA-Z][a-zA-Z0-9_-]*/g) || []) as string[])
  if (knownAgents.length === 0) {
    return tokens
  }

  const known = new Set(knownAgents.map((item) => item.toLowerCase()))
  return tokens.filter((token) => known.has(token))
}

function detectOperationToken(value: string): 'add' | 'remove' | 'update' | null {
  const token = value.toLowerCase().trim()

  if (['新增', '添加', '增加', 'add'].includes(token)) {
    return 'add'
  }
  if (['删除', '移除', '去掉', 'remove', 'delete'].includes(token)) {
    return 'remove'
  }
  if (['更新', '修改', '替换', 'update', 'replace'].includes(token)) {
    return 'update'
  }

  return null
}

type TelosField =
  | 'mission'
  | 'goals'
  | 'projects'
  | 'beliefs'
  | 'models'
  | 'strategies'
  | 'learnings'
  | 'preferences.communicationStyle'
  | 'preferences.preferredAgents'

function resolveFieldToken(tokenRaw: string): TelosField | null {
  const token = tokenRaw.toLowerCase().replace(/\s+/g, '')

  if (includesAnyTerm(token, ['使命', 'mission'])) {
    return 'mission'
  }
  if (includesAnyTerm(token, ['目标', 'goal'])) {
    return 'goals'
  }
  if (includesAnyTerm(token, ['项目', 'project'])) {
    return 'projects'
  }
  if (includesAnyTerm(token, ['信念', 'belief'])) {
    return 'beliefs'
  }
  if (includesAnyTerm(token, ['模型', 'model'])) {
    return 'models'
  }
  if (includesAnyTerm(token, ['策略', 'strategy'])) {
    return 'strategies'
  }
  if (includesAnyTerm(token, ['学习', 'learning'])) {
    return 'learnings'
  }
  if (includesAnyTerm(token, ['沟通风格', 'communicationstyle'])) {
    return 'preferences.communicationStyle'
  }
  if (includesAnyTerm(token, ['偏好agent', '偏好agents', 'preferredagents', 'agent偏好'])) {
    return 'preferences.preferredAgents'
  }

  return null
}

function splitUpdatePair(value: string): { from: string; to: string } | null {
  const match = value.match(/^(.+?)(?:->|=>|→)(.+)$/)
  if (!match) {
    return null
  }

  const from = match[1].trim()
  const to = match[2].trim()
  if (!from || !to) {
    return null
  }

  return { from, to }
}

function normalizeTarget(target: string): string {
  return target.replace(/\s+/g, ' ').trim().toLowerCase()
}

function matchByTarget(value: string, target: string): boolean {
  const left = normalizeTarget(value)
  const right = normalizeTarget(target)
  if (!left || !right) {
    return false
  }

  return left === right || left.includes(right) || right.includes(left)
}

function removeStringItems(values: string[], targets: string[]): string[] {
  if (targets.length === 0) {
    return values
  }

  return values.filter((item) => !targets.some((target) => matchByTarget(item, target)))
}

function replaceStringItem(values: string[], from: string, to: string): string[] {
  let replaced = false
  const next = values.map((item) => {
    if (!replaced && matchByTarget(item, from)) {
      replaced = true
      return to
    }
    return item
  })

  if (!replaced) {
    next.push(to)
  }

  return uniqueKeepOrder(next)
}

function upsertProject(projects: TelosProject[], project: TelosProject): TelosProject[] {
  const index = projects.findIndex((item) => item.name.toLowerCase() === project.name.toLowerCase())
  if (index < 0) {
    return [...projects, project]
  }

  const current = projects[index]
  const merged: TelosProject = {
    ...current,
    ...project,
    description: project.description || current.description
  }

  const next = [...projects]
  next[index] = merged
  return next
}

function removeProjects(projects: TelosProject[], targets: string[]): TelosProject[] {
  if (targets.length === 0) {
    return projects
  }

  return projects.filter((project) => !targets.some((target) => matchByTarget(project.name, target)))
}

function updateProject(projects: TelosProject[], from: string, toSpec: string): TelosProject[] {
  const toProject = parseProjectSpec(toSpec, from)
  if (!toProject) {
    return projects
  }

  const index = projects.findIndex((item) => item.name.toLowerCase() === from.toLowerCase())
  if (index < 0) {
    return upsertProject(projects, toProject)
  }

  const next = [...projects]
  next[index] = {
    ...next[index],
    ...toProject
  }
  return next
}

function inferImplicitPreferredAgents(prompt: string, knownAgents: string[]): string[] {
  if (knownAgents.length === 0) {
    return []
  }

  if (!/(优先|偏好|喜欢|倾向|prefer|preferred|以后请|尽量|default)/i.test(prompt)) {
    return []
  }

  const lowerPrompt = prompt.toLowerCase()
  return knownAgents.filter((agent) => lowerPrompt.includes(agent.toLowerCase()))
}

function inferImplicitProject(prompt: string): TelosProject | null {
  const patterns: RegExp[] = [
    /(?:项目|project)\s*[:：]\s*([A-Za-z0-9\u4e00-\u9fa5 _-]{2,60})/i,
    /(?:正在做|在做|负责|推进)\s*([A-Za-z0-9\u4e00-\u9fa5 _-]{2,40})(?:项目|project)/i,
    /(?:for|on)\s+project\s+([A-Za-z0-9 _-]{2,60})/i
  ]

  for (const pattern of patterns) {
    const match = prompt.match(pattern)
    if (!match || !match[1]) {
      continue
    }

    const name = match[1].replace(/[。,.，;；]+$/, '').trim()
    if (!name) {
      continue
    }

    return {
      name,
      description: prompt.replace(/\s+/g, ' ').trim().slice(0, 120),
      status: 'in-progress',
      priority: 'medium'
    }
  }

  return null
}

function sanitizeImplicitText(value: string, maxLength = 120): string {
  return value
    .replace(/[。.!！?？]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function captureImplicitClauses(prompt: string, patterns: RegExp[], maxLength = 120): string[] {
  const captured: string[] = []

  patterns.forEach((pattern) => {
    const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    let match = regex.exec(prompt)
    while (match) {
      const value = sanitizeImplicitText(match[1] || '', maxLength)
      if (value.length >= 4) {
        captured.push(value)
      }
      match = regex.exec(prompt)
    }
  })

  return uniqueKeepOrder(captured)
}

function inferImplicitAgentRemovals(prompt: string, knownAgents: string[]): string[] {
  if (knownAgents.length === 0) {
    return []
  }

  if (!/(不要|别|不再|排除|avoid|don't use|do not use|without)/i.test(prompt)) {
    return []
  }

  const lowerPrompt = prompt.toLowerCase()
  return knownAgents.filter((agent) => lowerPrompt.includes(agent.toLowerCase()))
}

function inferImplicitProjectRemovals(prompt: string): string[] {
  const patterns: RegExp[] = [
    /(?:不再做|暂停|停掉|移除|删除)\s*([A-Za-z0-9\u4e00-\u9fa5 _-]{2,50})(?:项目|project)/gi
  ]

  return captureImplicitClauses(prompt, patterns, 60)
}

function inferImplicitCommunicationStyle(prompt: string): string | null {
  if (/(简洁|精简|短一点|简短|concise|brief|short)/i.test(prompt)) {
    return 'concise'
  }
  if (/(详细|展开|细节多|深入一点|detailed|deep|thorough)/i.test(prompt)) {
    return 'detailed'
  }
  if (/(直接一点|直奔主题|直接|direct)/i.test(prompt)) {
    return 'direct'
  }

  return null
}

function inferImplicitMission(prompt: string): string | null {
  const patterns: RegExp[] = [
    /(?:我们的使命|我的使命|our mission|mission is)\s*(?:是|为|:|：)?\s*([^\n。!！?？;；]{4,160})/i
  ]

  for (const pattern of patterns) {
    const match = prompt.match(pattern)
    if (!match?.[1]) {
      continue
    }

    const mission = sanitizeImplicitText(match[1], 160)
    if (mission.length >= 4) {
      return mission
    }
  }

  return null
}

function inferImplicitGoals(prompt: string): string[] {
  const patterns: RegExp[] = [
    /(?:^|[\n。!！?？])\s*(?:我们)?(?:近期|当前|接下来|现在)?(?:的)?(?:目标|goal)(?:是|为|:|：)\s*([^\n。!！?？;；]{4,100})/gi,
    /(?:希望|想要|计划|打算)\s*(?:把|在)?\s*([^\n。!！?？;；]{6,100})/gi
  ]
  return captureImplicitClauses(prompt, patterns, 100)
}

function inferImplicitBeliefs(prompt: string): string[] {
  const patterns: RegExp[] = [
    /(?:我认为|我相信|我们认为|原则上|believe that|we believe)\s*([^\n。!！?？;；]{4,100})/gi
  ]
  return captureImplicitClauses(prompt, patterns, 100)
}

function inferImplicitStrategies(prompt: string): string[] {
  const patterns: RegExp[] = [
    /(?:策略(?:上)?|方法上|workflow|strategy)(?:是|为|:|：)\s*([^\n。!！?？;；]{4,100})/gi,
    /策略上\s*([^\n。!！?？;；]{4,100})/gi,
    /(?:我们通常|一般会|prefer to)\s*([^\n。!！?？;；]{4,100})/gi
  ]
  return captureImplicitClauses(prompt, patterns, 100)
}

function inferImplicitModels(prompt: string): string[] {
  const patterns: RegExp[] = [
    /(?:模型|model|mental model)(?:是|为|:|：)\s*([^\n。!！?？;；]{4,100})/gi
  ]
  return captureImplicitClauses(prompt, patterns, 100)
}

function inferImplicitLearnings(prompt: string): string[] {
  const patterns: RegExp[] = [
    /(?:请记住|记住|经验是|我学到|learned that|lesson learned)\s*([^\n。!！?？;；]{4,120})/gi
  ]
  return captureImplicitClauses(prompt, patterns, 120)
}

export function detectSystemTimeZone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (detected && typeof detected === 'string') {
      return detected
    }
  } catch {
    // no-op
  }

  return 'UTC'
}

export function normalizeTimeZone(value: unknown, fallback = detectSystemTimeZone()): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    const candidate = value.trim()
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date())
      return candidate
    } catch {
      return fallback
    }
  }

  return fallback
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value || '1970'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'
  return `${year}-${month}-${day}`
}

function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value || '1970'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'
  const hour = parts.find((part) => part.type === 'hour')?.value || '00'
  const minute = parts.find((part) => part.type === 'minute')?.value || '00'
  return `${year}-${month}-${day} ${hour}:${minute}`
}

export function buildTimeContext(timeZoneInput: string, now: Date = new Date()): TimeContext {
  const timeZone = normalizeTimeZone(timeZoneInput)
  const oneDay = 24 * 60 * 60 * 1000

  return {
    timeZone,
    localNow: formatDateTimeInTimeZone(now, timeZone),
    today: formatDateInTimeZone(now, timeZone),
    tomorrow: formatDateInTimeZone(new Date(now.getTime() + oneDay), timeZone),
    yesterday: formatDateInTimeZone(new Date(now.getTime() - oneDay), timeZone)
  }
}

const DEFAULT_TELOS_PROFILE: TelosProfile = {
  user: {
    name: 'User',
    aiName: 'Kai'
  },
  mission: 'Build safe and reliable systems',
  goals: [],
  projects: [],
  beliefs: [],
  models: [],
  strategies: [],
  learnings: [],
  preferences: {
    communicationStyle: 'direct',
    detailLevel: 'medium',
    responseLength: 'concise',
    preferredAgents: [],
    councilMode: true,
    learningEnabled: true,
    timeZone: detectSystemTimeZone()
  }
}

function normalizePreferences(value: unknown): TelosPreferences {
  if (!isRecord(value)) {
    return DEFAULT_TELOS_PROFILE.preferences
  }

  const preferredAgents = normalizeAgentList(toStringArray(value.preferredAgents))

  return {
    communicationStyle: toNonEmptyString(
      value.communicationStyle,
      DEFAULT_TELOS_PROFILE.preferences.communicationStyle
    ),
    detailLevel: toNonEmptyString(value.detailLevel, DEFAULT_TELOS_PROFILE.preferences.detailLevel),
    responseLength: toNonEmptyString(value.responseLength, DEFAULT_TELOS_PROFILE.preferences.responseLength),
    preferredAgents:
      preferredAgents.length > 0 ? preferredAgents : DEFAULT_TELOS_PROFILE.preferences.preferredAgents,
    councilMode:
      typeof value.councilMode === 'boolean' ? value.councilMode : DEFAULT_TELOS_PROFILE.preferences.councilMode,
    learningEnabled:
      typeof value.learningEnabled === 'boolean'
        ? value.learningEnabled
        : DEFAULT_TELOS_PROFILE.preferences.learningEnabled,
    timeZone: normalizeTimeZone(value.timeZone, DEFAULT_TELOS_PROFILE.preferences.timeZone)
  }
}

export function resolveProfilePath(gpaiDir: string): string {
  const primary = path.join(gpaiDir, 'data/profile.json')
  const fallback = path.join(process.cwd(), 'data/profile.json')
  return fs.existsSync(primary) ? primary : fallback
}

export function loadTelosProfile(gpaiDir: string): TelosProfile {
  const profilePath = resolveProfilePath(gpaiDir)

  if (!fs.existsSync(profilePath)) {
    return DEFAULT_TELOS_PROFILE
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath, 'utf-8'))
    const raw = isRecord(parsed) ? parsed : {}
    const userRaw = isRecord(raw.user) ? raw.user : {}

    const goals = Array.isArray(raw.goals) ? uniqueKeepOrder(toStringArray(raw.goals)) : DEFAULT_TELOS_PROFILE.goals
    const beliefs = Array.isArray(raw.beliefs)
      ? uniqueKeepOrder(toStringArray(raw.beliefs))
      : DEFAULT_TELOS_PROFILE.beliefs
    const models = Array.isArray(raw.models)
      ? uniqueKeepOrder(toStringArray(raw.models))
      : DEFAULT_TELOS_PROFILE.models
    const strategies = Array.isArray(raw.strategies)
      ? uniqueKeepOrder(toStringArray(raw.strategies))
      : DEFAULT_TELOS_PROFILE.strategies
    const learnings = Array.isArray(raw.learnings)
      ? uniqueKeepOrder(toStringArray(raw.learnings))
      : DEFAULT_TELOS_PROFILE.learnings

    return {
      user: {
        name: toNonEmptyString(userRaw.name, DEFAULT_TELOS_PROFILE.user.name),
        aiName: toNonEmptyString(userRaw.aiName, DEFAULT_TELOS_PROFILE.user.aiName),
        email: toNonEmptyString(userRaw.email)
      },
      mission: toTrimmedString(raw.mission, DEFAULT_TELOS_PROFILE.mission),
      goals,
      projects: normalizeProjects(raw.projects),
      beliefs,
      models,
      strategies,
      learnings,
      preferences: normalizePreferences(raw.preferences)
    }
  } catch {
    return DEFAULT_TELOS_PROFILE
  }
}

function readRawProfile(profilePath: string): Record<string, unknown> {
  if (!fs.existsSync(profilePath)) {
    return {}
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath, 'utf-8'))
    if (isRecord(parsed)) {
      return parsed
    }
    return {}
  } catch {
    return {}
  }
}

function writeRawProfile(profilePath: string, profile: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(profilePath), { recursive: true })
  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2))
}

function updateRawProfile(gpaiDir: string, mutate: (profile: Record<string, unknown>) => boolean): boolean {
  const profilePath = resolveProfilePath(gpaiDir)
  const raw = readRawProfile(profilePath)

  const changed = mutate(raw)
  if (!changed) {
    return false
  }

  writeRawProfile(profilePath, raw)
  return true
}

function sanitizeLearning(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function projectPriorityScore(priority: string): number {
  const text = priority.toLowerCase()
  if (includesAnyTerm(text, ['high', 'critical', 'p0', 'p1', '高', '紧急'])) {
    return 2
  }
  if (includesAnyTerm(text, ['medium', 'normal', 'p2', '中'])) {
    return 1
  }
  return 0.5
}

function projectStatusScore(status: string): number {
  const text = status.toLowerCase()
  if (includesAnyTerm(text, ['in-progress', 'active', 'ongoing', '进行中', '执行中'])) {
    return 2
  }
  if (includesAnyTerm(text, ['planned', 'planning', '待办'])) {
    return 1
  }
  if (includesAnyTerm(text, ['done', 'completed', '完成'])) {
    return 0.2
  }
  return 0.5
}

export function listFocusProjects(profile: TelosProfile, limit = 3): TelosProject[] {
  return [...profile.projects]
    .sort((a, b) => {
      const aScore = projectStatusScore(a.status) + projectPriorityScore(a.priority)
      const bScore = projectStatusScore(b.status) + projectPriorityScore(b.priority)
      return bScore - aScore
    })
    .slice(0, limit)
}

export function detectRelevantProjects(profile: TelosProfile, prompt: string, limit = 2): TelosProject[] {
  const text = prompt.trim()
  if (!text || profile.projects.length === 0) {
    return listFocusProjects(profile, limit)
  }

  const ranked = profile.projects
    .map((project) => {
      let score = projectStatusScore(project.status) + projectPriorityScore(project.priority)
      if (includesAnyTerm(text, [project.name])) {
        score += 4
      }

      const descriptionTerms = project.description
        .split(/[,\s，。；;]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2)
        .slice(0, 8)

      if (descriptionTerms.length > 0 && includesAnyTerm(text, descriptionTerms)) {
        score += 2
      }

      return { project, score }
    })
    .sort((a, b) => b.score - a.score)

  return ranked.slice(0, limit).map((item) => item.project)
}

export function appendTelosLearning(gpaiDir: string, learning: string, maxEntries = 40): boolean {
  const normalized = sanitizeLearning(learning)
  if (normalized.length < 8) {
    return false
  }

  return updateRawProfile(gpaiDir, (raw) => {
    const existing = uniqueKeepOrder(toStringArray(raw.learnings))
    if (existing.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      return false
    }

    existing.push(normalized)
    raw.learnings = existing.slice(-maxEntries)
    return true
  })
}

export function ensureTelosGoal(gpaiDir: string, goal: string, maxEntries = 20): boolean {
  const normalized = goal.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (normalized.length < 2) {
    return false
  }

  return updateRawProfile(gpaiDir, (raw) => {
    const existing = uniqueKeepOrder(toStringArray(raw.goals))
    if (existing.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      return false
    }

    existing.push(normalized)
    raw.goals = existing.slice(-maxEntries)
    return true
  })
}

export function applyTelosUpdatesFromPrompt(
  gpaiDir: string,
  prompt: string,
  options?: TelosUpdateOptions
): TelosUpdateResult {
  const lines = prompt
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const knownAgents = normalizeAgentList(options?.knownAgents || [])
  const changedFields = new Set<string>()

  const changed = updateRawProfile(gpaiDir, (raw) => {
    let mission = toTrimmedString(raw.mission, DEFAULT_TELOS_PROFILE.mission)
    let goals = uniqueKeepOrder(toStringArray(raw.goals))
    let beliefs = uniqueKeepOrder(toStringArray(raw.beliefs))
    let models = uniqueKeepOrder(toStringArray(raw.models))
    let strategies = uniqueKeepOrder(toStringArray(raw.strategies))
    let learnings = uniqueKeepOrder(toStringArray(raw.learnings))
    let projects = normalizeProjects(raw.projects)

    const preferencesRaw = isRecord(raw.preferences) ? raw.preferences : {}
    let communicationStyle = toNonEmptyString(
      preferencesRaw.communicationStyle,
      DEFAULT_TELOS_PROFILE.preferences.communicationStyle
    )
    let preferredAgents = normalizeAgentList(toStringArray(preferencesRaw.preferredAgents))
    if (preferredAgents.length === 0) {
      preferredAgents = DEFAULT_TELOS_PROFILE.preferences.preferredAgents
    }
    let timeZone = normalizeTimeZone(preferencesRaw.timeZone, DEFAULT_TELOS_PROFILE.preferences.timeZone)
    const detailLevel = toNonEmptyString(
      preferencesRaw.detailLevel,
      DEFAULT_TELOS_PROFILE.preferences.detailLevel
    )
    const responseLength = toNonEmptyString(
      preferencesRaw.responseLength,
      DEFAULT_TELOS_PROFILE.preferences.responseLength
    )
    const councilMode =
      typeof preferencesRaw.councilMode === 'boolean'
        ? preferencesRaw.councilMode
        : DEFAULT_TELOS_PROFILE.preferences.councilMode
    const learningEnabled =
      typeof preferencesRaw.learningEnabled === 'boolean'
        ? preferencesRaw.learningEnabled
        : DEFAULT_TELOS_PROFILE.preferences.learningEnabled

    const beforeSnapshot = JSON.stringify({
      mission,
      goals,
      beliefs,
      models,
      strategies,
      learnings,
      projects,
      communicationStyle,
      preferredAgents,
      timeZone
    })

    const setMission = (value: string): void => {
      const normalized = value.replace(/\s+/g, ' ').trim().slice(0, 200)
      if (!normalized || normalized === mission) {
        return
      }
      mission = normalized
      changedFields.add('mission')
    }

    const clearMission = (): void => {
      if (mission === '') {
        return
      }
      mission = ''
      changedFields.add('mission')
    }

    const mergeListField = (
      current: string[],
      values: string[],
      field: TelosField,
      prepend = false,
      maxEntries = 40
    ): string[] => {
      if (values.length === 0) {
        return current
      }

      const merged = prepend ? uniqueKeepOrder([...values, ...current]) : uniqueKeepOrder([...current, ...values])
      const trimmed = prepend ? merged.slice(0, maxEntries) : merged.slice(-maxEntries)
      if (trimmed.join('|') !== current.join('|')) {
        changedFields.add(field)
      }
      return trimmed
    }

    const removeListField = (current: string[], values: string[], field: TelosField): string[] => {
      if (values.length === 0) {
        return current
      }

      const next = removeStringItems(current, values)
      if (next.join('|') !== current.join('|')) {
        changedFields.add(field)
      }
      return next
    }

    const updateListField = (
      current: string[],
      updateSpec: string,
      field: TelosField,
      maxEntries = 40
    ): string[] => {
      const pair = splitUpdatePair(updateSpec)
      if (!pair) {
        return mergeListField(current, splitCsvLike(updateSpec), field, false, maxEntries)
      }

      const next = replaceStringItem(current, pair.from, pair.to)
      if (next.join('|') !== current.join('|')) {
        changedFields.add(field)
      }
      return next.slice(-maxEntries)
    }

    const updatePreferredAgents = (value: string, mode: 'add' | 'remove' | 'update' | 'set'): void => {
      const parsed = parseAgentsFromText(value, knownAgents)
      if (mode === 'set') {
        if (parsed.length > 0 && parsed.join('|') !== preferredAgents.join('|')) {
          preferredAgents = parsed
          changedFields.add('preferences.preferredAgents')
        }
        return
      }

      if (mode === 'add') {
        preferredAgents = mergeListField(
          preferredAgents,
          parsed,
          'preferences.preferredAgents',
          true,
          8
        )
        return
      }

      if (mode === 'remove') {
        preferredAgents = removeListField(preferredAgents, parsed, 'preferences.preferredAgents')
        return
      }

      preferredAgents = updateListField(
        preferredAgents,
        value,
        'preferences.preferredAgents',
        8
      )
    }

    lines.forEach((line) => {
      const missionMatch = line.match(/^(?:我的)?(?:使命|mission)\s*(?:是|:|：)\s*(.+)$/i)
      if (missionMatch?.[1]) {
        setMission(missionMatch[1])
      }

      const goalsMatch = line.match(/^(?:我的)?(?:目标|goals?)\s*(?:是|:|：)\s*(.+)$/i)
      if (goalsMatch?.[1]) {
        goals = mergeListField(goals, splitCsvLike(goalsMatch[1]), 'goals', false, 30)
      }

      const styleMatch = line.match(
        /^(?:我的)?(?:沟通风格|communication(?:\s+style)?)\s*(?:是|:|：)\s*(.+)$/i
      )
      if (styleMatch?.[1]) {
        const style = styleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 80)
        if (style && style !== communicationStyle) {
          communicationStyle = style
          changedFields.add('preferences.communicationStyle')
        }
      }

      const preferredAgentsMatch = line.match(
        /^(?:我的)?(?:偏好(?:的)?\s*(?:agent|agents|角色)?|preferred\s*agents?)\s*(?:是|:|：)\s*(.+)$/i
      )
      if (preferredAgentsMatch?.[1]) {
        updatePreferredAgents(preferredAgentsMatch[1], 'set')
      }

      const opMatch = line.match(
        /^(新增|添加|增加|add|删除|移除|去掉|remove|delete|更新|修改|替换|update|replace)\s*(.+?)\s*[:：]\s*(.+)$/i
      )
      if (!opMatch) {
        return
      }

      const operation = detectOperationToken(opMatch[1])
      const field = resolveFieldToken(opMatch[2])
      const value = opMatch[3].trim()
      if (!operation || !field || !value) {
        return
      }

      switch (field) {
        case 'mission': {
          if (operation === 'remove') {
            clearMission()
            return
          }
          setMission(operation === 'update' ? (splitUpdatePair(value)?.to || value) : value)
          return
        }

        case 'goals':
        case 'beliefs':
        case 'models':
        case 'strategies':
        case 'learnings': {
          const parsed = splitCsvLike(value)
          const maxEntries = field === 'goals' ? 30 : 40

          if (field === 'goals') {
            if (operation === 'add') {
              goals = mergeListField(goals, parsed, field, false, maxEntries)
            } else if (operation === 'remove') {
              goals = removeListField(goals, parsed, field)
            } else {
              goals = updateListField(goals, value, field, maxEntries)
            }
            return
          }

          if (field === 'beliefs') {
            if (operation === 'add') {
              beliefs = mergeListField(beliefs, parsed, field, false, maxEntries)
            } else if (operation === 'remove') {
              beliefs = removeListField(beliefs, parsed, field)
            } else {
              beliefs = updateListField(beliefs, value, field, maxEntries)
            }
            return
          }

          if (field === 'models') {
            if (operation === 'add') {
              models = mergeListField(models, parsed, field, false, maxEntries)
            } else if (operation === 'remove') {
              models = removeListField(models, parsed, field)
            } else {
              models = updateListField(models, value, field, maxEntries)
            }
            return
          }

          if (field === 'strategies') {
            if (operation === 'add') {
              strategies = mergeListField(strategies, parsed, field, false, maxEntries)
            } else if (operation === 'remove') {
              strategies = removeListField(strategies, parsed, field)
            } else {
              strategies = updateListField(strategies, value, field, maxEntries)
            }
            return
          }

          if (operation === 'add') {
            learnings = mergeListField(learnings, parsed, field, false, maxEntries)
          } else if (operation === 'remove') {
            learnings = removeListField(learnings, parsed, field)
          } else {
            learnings = updateListField(learnings, value, field, maxEntries)
          }
          return
        }

        case 'projects': {
          if (operation === 'add') {
            parseProjectValues(value).forEach((project) => {
              const next = upsertProject(projects, project)
              if (JSON.stringify(next) !== JSON.stringify(projects)) {
                projects = next
                changedFields.add('projects')
              }
            })
            return
          }

          if (operation === 'remove') {
            const targets = splitCsvLike(value)
            const next = removeProjects(projects, targets)
            if (JSON.stringify(next) !== JSON.stringify(projects)) {
              projects = next
              changedFields.add('projects')
            }
            return
          }

          const updatePair = splitUpdatePair(value)
          if (updatePair) {
            const next = updateProject(projects, updatePair.from, updatePair.to)
            if (JSON.stringify(next) !== JSON.stringify(projects)) {
              projects = next
              changedFields.add('projects')
            }
            return
          }

          parseProjectValues(value).forEach((project) => {
            const next = upsertProject(projects, project)
            if (JSON.stringify(next) !== JSON.stringify(projects)) {
              projects = next
              changedFields.add('projects')
            }
          })
          return
        }

        case 'preferences.communicationStyle': {
          if (operation === 'remove') {
            if (communicationStyle !== DEFAULT_TELOS_PROFILE.preferences.communicationStyle) {
              communicationStyle = DEFAULT_TELOS_PROFILE.preferences.communicationStyle
              changedFields.add('preferences.communicationStyle')
            }
            return
          }
          const style = (splitUpdatePair(value)?.to || value).replace(/\s+/g, ' ').trim().slice(0, 80)
          if (style && style !== communicationStyle) {
            communicationStyle = style
            changedFields.add('preferences.communicationStyle')
          }
          return
        }

        case 'preferences.preferredAgents': {
          updatePreferredAgents(
            operation === 'update' ? (splitUpdatePair(value)?.to || value) : value,
            operation === 'add' ? 'add' : operation === 'remove' ? 'remove' : 'update'
          )
        }
      }
    })

    const inferredAgents = inferImplicitPreferredAgents(prompt, knownAgents)
    if (inferredAgents.length > 0) {
      preferredAgents = mergeListField(
        preferredAgents,
        inferredAgents,
        'preferences.preferredAgents',
        true,
        8
      )
    }

    const inferredAgentRemovals = inferImplicitAgentRemovals(prompt, knownAgents)
    if (inferredAgentRemovals.length > 0) {
      preferredAgents = removeListField(
        preferredAgents,
        inferredAgentRemovals,
        'preferences.preferredAgents'
      )
    }

    const inferredProject = inferImplicitProject(prompt)
    if (inferredProject) {
      const next = upsertProject(projects, inferredProject)
      if (JSON.stringify(next) !== JSON.stringify(projects)) {
        projects = next
        changedFields.add('projects')
      }
    }

    const inferredProjectRemovals = inferImplicitProjectRemovals(prompt)
    if (inferredProjectRemovals.length > 0) {
      const next = removeProjects(projects, inferredProjectRemovals)
      if (JSON.stringify(next) !== JSON.stringify(projects)) {
        projects = next
        changedFields.add('projects')
      }
    }

    const inferredCommunicationStyle = inferImplicitCommunicationStyle(prompt)
    if (
      inferredCommunicationStyle &&
      inferredCommunicationStyle !== communicationStyle &&
      !includesAnyTerm(prompt, ['时区', 'timezone', 'time zone'])
    ) {
      communicationStyle = inferredCommunicationStyle
      changedFields.add('preferences.communicationStyle')
    }

    const inferredMission = inferImplicitMission(prompt)
    if (inferredMission) {
      setMission(inferredMission)
    }

    goals = mergeListField(goals, inferImplicitGoals(prompt), 'goals', false, 30)
    beliefs = mergeListField(beliefs, inferImplicitBeliefs(prompt), 'beliefs', false, 40)
    models = mergeListField(models, inferImplicitModels(prompt), 'models', false, 40)
    strategies = mergeListField(strategies, inferImplicitStrategies(prompt), 'strategies', false, 40)
    learnings = mergeListField(learnings, inferImplicitLearnings(prompt), 'learnings', false, 40)

    const afterSnapshot = JSON.stringify({
      mission,
      goals,
      beliefs,
      models,
      strategies,
      learnings,
      projects,
      communicationStyle,
      preferredAgents,
      timeZone
    })

    if (beforeSnapshot === afterSnapshot) {
      return false
    }

    raw.mission = mission
    raw.goals = goals
    raw.beliefs = beliefs
    raw.models = models
    raw.strategies = strategies
    raw.learnings = learnings
    raw.projects = projects
    raw.preferences = {
      ...preferencesRaw,
      communicationStyle,
      detailLevel,
      responseLength,
      preferredAgents,
      councilMode,
      learningEnabled,
      timeZone
    }
    return true
  })

  return {
    updated: changed,
    fields: uniqueKeepOrder([...changedFields])
  }
}
