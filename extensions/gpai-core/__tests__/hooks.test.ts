import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleAfterAgent } from '../hooks/AfterAgent'
import { handleBeforeAgent } from '../hooks/BeforeAgent'
import { handleBeforeTool } from '../hooks/BeforeTool'
import { handleSessionStart } from '../hooks/SessionStart'

interface WorkMeta {
  id: string
  sessionId: string
  prompt: string
  intent: string
  project?: string
  complexity?: 'low' | 'medium' | 'high'
  createdAt: string
  updatedAt: string
  status: 'in-progress' | 'completed' | 'failed'
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

describe('GPAI Hooks', () => {
  const fixtureGpaiDir = path.resolve(__dirname, '../../../test-data/.gpai')
  let runtimeGpaiDir = ''

  function workRoot(): string {
    return path.join(runtimeGpaiDir, 'data/work')
  }

  function listWorkMetas(): WorkMeta[] {
    const root = workRoot()
    if (!fs.existsSync(root)) {
      return []
    }

    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('_work'))
      .map((entry) => {
        const metaPath = path.join(root, entry.name, 'META.json')
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as WorkMeta
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  function readHistory(): Array<Record<string, unknown>> {
    const filePath = path.join(runtimeGpaiDir, 'data/history.json')
    if (!fs.existsSync(filePath)) {
      return []
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  }

  function appendHistory(entries: Array<Record<string, unknown>>): void {
    const filePath = path.join(runtimeGpaiDir, 'data/history.json')
    const merged = readHistory().concat(entries)
    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2))
  }

  function readProfile(): Record<string, unknown> {
    const profilePath = path.join(runtimeGpaiDir, 'data/profile.json')
    return JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as Record<string, unknown>
  }

  beforeAll(() => {
    runtimeGpaiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpai-hooks-'))
    fs.cpSync(fixtureGpaiDir, runtimeGpaiDir, { recursive: true })

    process.env.GPAI_DIR = runtimeGpaiDir

    const warmPath = path.join(runtimeGpaiDir, 'data/memory/warm.jsonl')
    const hotPath = path.join(runtimeGpaiDir, 'data/memory/hot.jsonl')
    const historyPath = path.join(runtimeGpaiDir, 'data/history.json')

    fs.mkdirSync(path.dirname(warmPath), { recursive: true })
    fs.writeFileSync(
      warmPath,
      `${JSON.stringify({
        type: 'success',
        content: 'Security review found SQL injection risk',
        rating: 9
      })}\n`
    )
    fs.writeFileSync(hotPath, '')
    fs.writeFileSync(historyPath, '[]')

    const profilePath = path.join(runtimeGpaiDir, 'data/profile.json')
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as Record<string, unknown>
    profile.projects = [
      {
        name: 'Auth Platform',
        description: 'API authentication and authorization hardening',
        status: 'in-progress',
        priority: 'high'
      }
    ]
    profile.beliefs = ['Security first']
    profile.strategies = ['Multi-perspective review']
    profile.preferences = {
      ...((profile.preferences as Record<string, unknown>) || {}),
      timeZone: 'Asia/Shanghai'
    }
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2))

    fs.readdirSync(workRoot(), { withFileTypes: true }).forEach((entry) => {
      if (entry.isDirectory() && entry.name.endsWith('_work')) {
        fs.rmSync(path.join(workRoot(), entry.name), { recursive: true, force: true })
      }
    })
  })

  afterAll(() => {
    delete process.env.GPAI_DIR
    if (runtimeGpaiDir) {
      fs.rmSync(runtimeGpaiDir, { recursive: true, force: true })
    }
  })

  describe('SessionStart Hook', () => {
    it('should load profile and memory', async () => {
      const result = await handleSessionStart({
        sessionId: 'test-session-1',
        timestamp: Date.now()
      })

      expect(result.context).toBeTruthy()
      expect(result.systemPrompt).toBeTruthy()
      expect(result.context).toContain('Active Projects')
      expect(result.context).toContain('Time Context')
      expect(result.metadata.sessionId).toBe('test-session-1')
    })

    it('should handle missing profile gracefully', async () => {
      process.env.GPAI_DIR = '/nonexistent'

      const result = await handleSessionStart({
        sessionId: 'test-session-2',
        timestamp: Date.now()
      })

      expect(result.systemPrompt).toBeTruthy()
      expect(result.systemPrompt).toContain('intelligent AI assistant')
      process.env.GPAI_DIR = runtimeGpaiDir
    })
  })

  describe('BeforeAgent Hook', () => {
    it('should analyze intent, select agents, and create in-progress work item', async () => {
      const sessionId = 'before-agent-session'
      const beforeIds = new Set(listWorkMetas().map((meta) => meta.id))

      const result = await handleBeforeAgent({
        prompt: 'Analyze the security of this code',
        sessionId,
        conversationHistory: []
      })

      expect(result.suggestedAgents).toContain('analyst')
      expect(result.modifiedPrompt).toContain('System Guidance')

      const created = listWorkMetas().find((meta) => !beforeIds.has(meta.id))
      expect(created).toBeTruthy()
      expect(created?.sessionId).toBe(sessionId)
      expect(created?.status).toBe('in-progress')
      expect(created?.agents.length).toBeGreaterThan(0)
      expect(result.modifiedPrompt).toContain('Mission Anchor')
      expect(result.modifiedPrompt).toContain('Related Projects')
      expect(created?.project).toBeTruthy()
    })

    it('should update TELOS fields from explicit prompt signals', async () => {
      const sessionId = 'before-agent-telos-update-session'
      const beforeProfile = readProfile()
      const beforePreferences = (beforeProfile.preferences as Record<string, unknown>) || {}
      const beforeTimeZone = String(beforePreferences.timeZone || '')

      const result = await handleBeforeAgent({
        prompt:
          '目标: 建立自动化安全回归\n新增目标: 提升交付稳定性\n删除目标: Goal A\n更新目标: Goal B -> 自动化交付质量\n删除使命: reset\n偏好agent: devil, analyst\n更新偏好agent: devil -> engineer\n沟通风格: concise\n时区: UTC',
        sessionId,
        conversationHistory: []
      })

      const profile = readProfile()
      const goals = Array.isArray(profile.goals) ? (profile.goals as string[]) : []
      const preferences = (profile.preferences as Record<string, unknown>) || {}
      const preferredAgents = Array.isArray(preferences.preferredAgents)
        ? (preferences.preferredAgents as string[])
        : []

      expect(goals).toContain('建立自动化安全回归')
      expect(goals).toContain('提升交付稳定性')
      expect(goals).toContain('自动化交付质量')
      expect(goals).not.toContain('Goal A')
      expect(profile.mission).toBe('')
      expect(preferredAgents).toContain('engineer')
      expect(preferredAgents).toContain('analyst')
      expect(preferences.communicationStyle).toBe('concise')
      expect(preferences.timeZone).toBe(beforeTimeZone)
      expect(result.systemInstructions).toContain('TELOS updated from this request')
      expect(result.modifiedPrompt).toContain('Relative Dates:')
    })

    it('should learn preferred agents and project implicitly from natural language', async () => {
      const sessionId = 'before-agent-implicit-telos-session'

      await handleBeforeAgent({
        prompt: '我们正在做 Payment Gateway 项目，请以后优先用 analyst 和 devil 来审计风险',
        sessionId,
        conversationHistory: []
      })

      const profile = readProfile()
      const preferences = (profile.preferences as Record<string, unknown>) || {}
      const preferredAgents = Array.isArray(preferences.preferredAgents)
        ? (preferences.preferredAgents as string[])
        : []
      const projects = Array.isArray(profile.projects)
        ? (profile.projects as Array<Record<string, unknown>>)
        : []

      expect(preferredAgents).toContain('analyst')
      expect(preferredAgents).toContain('devil')
      expect(projects.some((project) => String(project.name || '').includes('Payment Gateway'))).toBe(true)
    })

    it('should infer and apply implicit TELOS updates for goals, beliefs, models, strategies and learnings', async () => {
      const sessionId = 'before-agent-implicit-rich-telos-session'

      await handleBeforeAgent({
        prompt:
          '我们接下来目标是提升支付链路稳定性。我认为先安全后速度。模型是风险优先。策略上先复盘再改动。请记住每次上线前先跑回归。',
        sessionId,
        conversationHistory: []
      })

      const profile = readProfile()
      const goals = Array.isArray(profile.goals) ? (profile.goals as string[]) : []
      const beliefs = Array.isArray(profile.beliefs) ? (profile.beliefs as string[]) : []
      const models = Array.isArray(profile.models) ? (profile.models as string[]) : []
      const strategies = Array.isArray(profile.strategies) ? (profile.strategies as string[]) : []
      const learnings = Array.isArray(profile.learnings) ? (profile.learnings as string[]) : []

      expect(goals.some((goal) => goal.includes('提升支付链路稳定性'))).toBe(true)
      expect(beliefs.some((belief) => belief.includes('先安全后速度'))).toBe(true)
      expect(models.some((model) => model.includes('风险优先'))).toBe(true)
      expect(strategies.some((strategy) => strategy.includes('先复盘再改动'))).toBe(true)
      expect(learnings.some((learning) => learning.includes('上线前先跑回归'))).toBe(true)
    })

    it('should support per-turn hard include/exclude agent constraints', async () => {
      const sessionId = 'before-agent-hard-constraints-session'

      const result = await handleBeforeAgent({
        prompt:
          '本轮包含agent: researcher, writer, devil\n本轮排除agent: analyst\n请输出调研结论与可执行建议',
        sessionId,
        conversationHistory: []
      })

      expect(result.suggestedAgents).toContain('researcher')
      expect(result.suggestedAgents).toContain('writer')
      expect(result.suggestedAgents).toContain('devil')
      expect(result.suggestedAgents).not.toContain('analyst')
      expect(result.modifiedPrompt).toContain('Agent Constraints:')
      expect(result.systemInstructions).toContain('Agent override')
    })
  })

  describe('AfterAgent Hook', () => {
    it('should mark work as completed and append history', async () => {
      const sessionId = 'after-agent-success-session'
      const beforeProfile = readProfile()
      const beforeLearnings = Array.isArray(beforeProfile.learnings) ? beforeProfile.learnings.length : 0

      await handleBeforeAgent({
        prompt: 'Review this auth middleware',
        sessionId,
        conversationHistory: []
      })

      const result = await handleAfterAgent({
        sessionId,
        prompt: 'Review this auth middleware',
        result: 'Found 2 medium risks and 1 low risk.',
        executionTime: 1240,
        tools_used: ['shell', 'filesystem'],
        model_calls: 3,
        success: true
      })

      expect(result.askForRating).toBe(true)

      const targetMeta = listWorkMetas().find((meta) => meta.sessionId === sessionId)
      expect(targetMeta?.status).toBe('completed')
      expect(targetMeta?.execution?.modelCalls).toBe(3)
      expect(targetMeta?.resultSummary).toContain('Found 2 medium risks')

      const history = readHistory()
      const entry = history.find((item) => item.sessionId === sessionId) as
        | Record<string, unknown>
        | undefined
      expect(entry).toBeTruthy()
      expect(entry?.status).toBe('completed')
      expect(entry?.intent).toBe(targetMeta?.intent)

      const afterProfile = readProfile()
      const learnings = Array.isArray(afterProfile.learnings) ? (afterProfile.learnings as string[]) : []
      expect(learnings.length).toBeGreaterThan(beforeLearnings)
      expect(learnings[learnings.length - 1]).toContain('Found 2 medium risks')
    })

    it('should mark work as failed and append failure history', async () => {
      const sessionId = 'after-agent-fail-session'

      await handleBeforeAgent({
        prompt: 'Investigate incident timeline',
        sessionId,
        conversationHistory: []
      })

      const result = await handleAfterAgent({
        sessionId,
        prompt: 'Investigate incident timeline',
        result: 'Task stopped due to tool timeout.',
        executionTime: 2100,
        tools_used: ['shell'],
        model_calls: 1,
        success: false,
        error: { message: 'Tool timeout' }
      })

      expect(result.askForRating).toBe(false)
      expect(result.message).toContain('Task failed')

      const targetMeta = listWorkMetas().find((meta) => meta.sessionId === sessionId)
      expect(targetMeta?.status).toBe('failed')
      expect(targetMeta?.execution?.errorMessage).toBe('Tool timeout')

      const history = readHistory()
      const entry = history.find((item) => item.sessionId === sessionId) as
        | Record<string, unknown>
        | undefined
      expect(entry).toBeTruthy()
      expect(entry?.status).toBe('failed')
    })
  })

  describe('Preference Memory', () => {
    it('should use feedback memory to influence next agent selection', async () => {
      const ratingSessionId = 'preference-rating-session'

      await handleBeforeAgent({
        prompt: 'Research OSINT indicators for this incident',
        sessionId: ratingSessionId,
        conversationHistory: []
      })

      await handleAfterAgent({
        sessionId: ratingSessionId,
        prompt: 'Research OSINT indicators for this incident',
        result: 'Produced a useful indicator set.',
        executionTime: 980,
        tools_used: ['shell'],
        model_calls: 2,
        success: true
      })

      await handleBeforeAgent({
        prompt: '评分 9 分，analyst 和 devil 组合很好',
        sessionId: ratingSessionId,
        conversationHistory: []
      })

      const history = readHistory()
      const ratedEntries = history.filter(
        (item) => item.sessionId === ratingSessionId && item.status === 'completed'
      )
      const ratedEntry = ratedEntries[ratedEntries.length - 1]
      expect(ratedEntry?.rating).toBe(9)

      const next = await handleBeforeAgent({
        prompt: 'Debug this TypeScript bug in production',
        sessionId: 'preference-next-session',
        conversationHistory: []
      })

      expect(next.suggestedAgents[0]).toBe('devil')
      expect(next.suggestedAgents).toContain('engineer')
    })

    it('should update profile successPatterns over task outcomes and ratings', async () => {
      const sessionId = 'success-pattern-session'

      await handleBeforeAgent({
        prompt: 'Research attack surface for this API',
        sessionId,
        conversationHistory: []
      })

      await handleAfterAgent({
        sessionId,
        prompt: 'Research attack surface for this API',
        result: 'Initial research completed with key findings.',
        executionTime: 800,
        tools_used: ['shell'],
        model_calls: 1,
        success: true
      })

      let profile = readProfile()
      let patterns = (profile.successPatterns as Array<Record<string, unknown>>) || []
      let researchPattern = patterns.find((item) => item.task === 'research')
      expect(researchPattern).toBeTruthy()
      expect((researchPattern?.successRate as number) || 0).toBeGreaterThan(0.6)

      await handleBeforeAgent({
        prompt: '评分 10 分，analyst + devil 非常有效',
        sessionId,
        conversationHistory: []
      })

      profile = readProfile()
      patterns = (profile.successPatterns as Array<Record<string, unknown>>) || []
      const researchPatterns = patterns.filter((item) => item.task === 'research')
      expect(researchPatterns.length).toBeGreaterThan(0)

      const strongest = researchPatterns.reduce((best, current) => {
        const bestRate = (best.successRate as number) || 0
        const currentRate = (current.successRate as number) || 0
        return currentRate > bestRate ? current : best
      })

      const contextPattern = researchPatterns.find(
        (item) => item.toolCombo === 'shell' && typeof item.project === 'string'
      )

      expect((strongest.successRate as number) || 0).toBeGreaterThan(0.8)
      expect((strongest.sampleSize as number) || 0).toBeGreaterThanOrEqual(2)
      expect(contextPattern).toBeTruthy()
      expect((contextPattern?.sampleSize as number) || 0).toBeGreaterThanOrEqual(2)
      expect(['low', 'medium', 'high']).toContain(String(contextPattern?.complexity || ''))
    })

    it('should prioritize agents from context-similar historical outcomes', async () => {
      const now = Date.now()
      appendHistory([
        {
          sessionId: 'similarity-positive-1',
          intent: 'research',
          project: 'Auth Platform',
          complexity: 'medium',
          agents: ['researcher', 'writer'],
          prompt: 'Research Auth Platform OAuth migration and write an evidence report.',
          result: 'Collected source evidence and produced a concise migration report.',
          status: 'completed',
          timestamp: new Date(now - 30 * 60 * 1000).toISOString(),
          toolsUsed: ['web', 'filesystem'],
          rating: 10
        },
        {
          sessionId: 'similarity-positive-2',
          intent: 'research',
          project: 'Auth Platform',
          complexity: 'medium',
          agents: ['researcher', 'writer', 'devil'],
          prompt: 'Search latest OAuth docs and draft a decision brief for Auth Platform.',
          result: 'Compared options and wrote decision brief with trade-offs.',
          status: 'completed',
          timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          toolsUsed: ['web', 'filesystem'],
          rating: 9
        },
        {
          sessionId: 'similarity-negative-1',
          intent: 'research',
          project: 'Auth Platform',
          complexity: 'medium',
          agents: ['analyst', 'devil'],
          prompt: 'Research auth migration but skip report structure.',
          result: 'Output was hard to use and lacked decision structure.',
          status: 'completed',
          timestamp: new Date(now - 60 * 60 * 1000).toISOString(),
          toolsUsed: ['web', 'filesystem'],
          rating: 2
        }
      ])

      const result = await handleBeforeAgent({
        prompt: 'Research Auth Platform by searching latest docs, then write a concise report file.',
        sessionId: 'similarity-evidence-session',
        conversationHistory: []
      })

      expect(result.suggestedAgents.slice(0, 2)).toEqual(expect.arrayContaining(['researcher', 'writer']))
      expect(result.systemInstructions).toContain('Context similarity boost')
      expect(result.systemInstructions).toContain('Context-similar case')
    })

    it('should allow high-confidence cross-intent agents to replace baseline slots', async () => {
      const now = Date.now()
      appendHistory([
        {
          sessionId: 'cross-intent-positive-1',
          intent: 'technical',
          project: 'Auth Platform',
          complexity: 'medium',
          agents: ['engineer', 'writer', 'researcher'],
          prompt: 'Implement TypeScript changes and deliver a migration report for Auth Platform.',
          result: 'Code changes landed with a clear migration report and evidence.',
          status: 'completed',
          timestamp: new Date(now - 20 * 60 * 1000).toISOString(),
          toolsUsed: ['shell', 'filesystem', 'web'],
          rating: 10
        },
        {
          sessionId: 'cross-intent-positive-2',
          intent: 'technical',
          project: 'Auth Platform',
          complexity: 'medium',
          agents: ['engineer', 'writer', 'researcher'],
          prompt: 'Patch auth middleware and publish concise technical doc.',
          result: 'Patch verified and report accepted.',
          status: 'completed',
          timestamp: new Date(now - 90 * 60 * 1000).toISOString(),
          toolsUsed: ['shell', 'filesystem', 'web'],
          rating: 9
        },
        {
          sessionId: 'cross-intent-negative-1',
          intent: 'technical',
          project: 'Auth Platform',
          complexity: 'medium',
          agents: ['architect', 'qa'],
          prompt: 'Only architecture and test checklist without implementation output.',
          result: 'Output lacked deliverable detail.',
          status: 'completed',
          timestamp: new Date(now - 45 * 60 * 1000).toISOString(),
          toolsUsed: ['shell', 'filesystem'],
          rating: 3
        }
      ])

      const result = await handleBeforeAgent({
        prompt:
          'Implement TypeScript auth middleware changes for Auth Platform, search latest docs, and write a concise report.',
        sessionId: 'cross-intent-selection-session',
        conversationHistory: []
      })

      expect(result.suggestedAgents).toContain('engineer')
      expect(result.suggestedAgents).toContain('writer')
      expect(result.suggestedAgents).toContain('researcher')
      expect(result.systemInstructions).toContain('Dynamic composition injected')
    })
  })

  describe('BeforeTool Hook', () => {
    it('should allow safe operations', async () => {
      const result = await handleBeforeTool({
        tool: 'shell',
        args: { command: 'ls -la' },
        context: ''
      })

      expect(result.allowed).toBe(true)
      expect(result.action).toBe('allow')
    })

    it('should block dangerous operations', async () => {
      const result = await handleBeforeTool({
        tool: 'shell',
        args: { command: 'rm -rf /' },
        context: ''
      })

      expect(result.allowed).toBe(false)
      expect(result.action).toBe('block')
    })
  })
})
