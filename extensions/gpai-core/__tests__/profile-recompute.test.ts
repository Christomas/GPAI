import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  maybeRecomputeSuccessPatterns,
  SUCCESS_PATTERN_RECOMPUTE_POLICY,
  type SuccessPattern
} from '../utils/profile'

type HistoryRow = Record<string, unknown>

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>
}

function buildHistoryRows(count: number, withRatings = 0): HistoryRow[] {
  const baseMs = Date.parse('2026-02-16T00:00:00.000Z')
  return Array.from({ length: count }, (_, index) => {
    const row: HistoryRow = {
      sessionId: `session-${index}`,
      intent: 'research',
      project: 'Alpha',
      complexity: 'medium',
      agents: ['analyst', 'engineer'],
      toolsUsed: ['shell', 'filesystem'],
      result: `result-${index}`,
      executionTime: 1200 + index * 10,
      modelCalls: 2,
      status: index % 5 === 0 ? 'failed' : 'completed',
      timestamp: new Date(baseMs + index * 1000).toISOString()
    }

    if (index < withRatings) {
      row.rating = 8 + (index % 2)
    }

    return row
  })
}

describe('success pattern recompute automation', () => {
  let gpaiDir = ''

  function profilePath(): string {
    return path.join(gpaiDir, 'data/profile.json')
  }

  function historyPath(): string {
    return path.join(gpaiDir, 'data/history.json')
  }

  function learningConfigPath(): string {
    return path.join(gpaiDir, 'config/learning.json')
  }

  beforeEach(() => {
    gpaiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpai-recompute-'))
    writeJson(profilePath(), {
      user: {
        name: 'Test User',
        aiName: 'Kai'
      },
      mission: '',
      goals: [],
      projects: [],
      beliefs: [],
      models: [],
      strategies: [],
      learnings: [],
      preferences: {
        communicationStyle: 'direct',
        preferredAgents: [],
        councilMode: true,
        learningEnabled: true,
        timeZone: 'UTC'
      }
    })
    writeJson(historyPath(), [])
  })

  afterEach(() => {
    if (gpaiDir) {
      fs.rmSync(gpaiDir, { recursive: true, force: true })
    }
  })

  it('should not trigger recompute when history delta is below threshold', () => {
    const rows = buildHistoryRows(SUCCESS_PATTERN_RECOMPUTE_POLICY.historyDeltaThreshold - 1)
    writeJson(historyPath(), rows)

    const result = maybeRecomputeSuccessPatterns(gpaiDir)
    expect(result.triggered).toBe(false)
    expect(result.reason).toBe('threshold-not-met')
    expect(result.deltaHistory).toBe(SUCCESS_PATTERN_RECOMPUTE_POLICY.historyDeltaThreshold - 1)
  })

  it('should trigger recompute when history delta reaches threshold and write contextual patterns', () => {
    const rows = buildHistoryRows(SUCCESS_PATTERN_RECOMPUTE_POLICY.historyDeltaThreshold)
    writeJson(historyPath(), rows)

    const result = maybeRecomputeSuccessPatterns(gpaiDir)
    expect(result.triggered).toBe(true)
    expect(result.reason).toBe('history-threshold')
    expect(result.updatedPatternCount).toBeGreaterThan(0)

    const profile = readJson(profilePath())
    const patterns = Array.isArray(profile.successPatterns) ? (profile.successPatterns as SuccessPattern[]) : []
    const target = patterns.find(
      (pattern) =>
        pattern.task === 'research' &&
        pattern.method === 'analyst + engineer' &&
        pattern.toolCombo === 'filesystem + shell' &&
        pattern.project === 'Alpha' &&
        pattern.complexity === 'medium'
    )

    expect(target).toBeTruthy()
    expect((target?.sampleSize as number) || 0).toBeGreaterThanOrEqual(
      SUCCESS_PATTERN_RECOMPUTE_POLICY.historyDeltaThreshold
    )

    const learningMeta = (profile.learningMeta as Record<string, unknown>) || {}
    const recomputeMeta = (learningMeta.successPatternRecompute as Record<string, unknown>) || {}
    expect(recomputeMeta.lastHistoryCount).toBe(SUCCESS_PATTERN_RECOMPUTE_POLICY.historyDeltaThreshold)
  })

  it('should trigger by rating threshold after cooldown', () => {
    const count = SUCCESS_PATTERN_RECOMPUTE_POLICY.historyDeltaThreshold
    writeJson(historyPath(), buildHistoryRows(count, 0))

    const firstRunTime = new Date('2026-02-16T00:00:00.000Z')
    const forced = maybeRecomputeSuccessPatterns(gpaiDir, { force: true, now: firstRunTime })
    expect(forced.triggered).toBe(true)

    writeJson(historyPath(), buildHistoryRows(count, SUCCESS_PATTERN_RECOMPUTE_POLICY.ratedDeltaThreshold))

    const duringCooldown = maybeRecomputeSuccessPatterns(gpaiDir, {
      now: new Date(firstRunTime.getTime() + 60 * 1000)
    })
    expect(duringCooldown.triggered).toBe(false)
    expect(duringCooldown.reason).toBe('cooldown')

    const afterCooldown = maybeRecomputeSuccessPatterns(gpaiDir, {
      now: new Date(firstRunTime.getTime() + SUCCESS_PATTERN_RECOMPUTE_POLICY.minIntervalMs + 1000)
    })
    expect(afterCooldown.triggered).toBe(true)
    expect(afterCooldown.reason).toBe('rating-threshold')
    expect(afterCooldown.deltaRated).toBe(SUCCESS_PATTERN_RECOMPUTE_POLICY.ratedDeltaThreshold)
  })

  it('should use configured thresholds from learning.json', () => {
    writeJson(learningConfigPath(), {
      successPatternRecompute: {
        historyDeltaThreshold: 5,
        ratedDeltaThreshold: 2,
        minIntervalMinutes: 1
      }
    })

    writeJson(historyPath(), buildHistoryRows(4, 0))
    const below = maybeRecomputeSuccessPatterns(gpaiDir)
    expect(below.triggered).toBe(false)
    expect(below.reason).toBe('threshold-not-met')

    writeJson(historyPath(), buildHistoryRows(5, 0))
    const hit = maybeRecomputeSuccessPatterns(gpaiDir)
    expect(hit.triggered).toBe(true)
    expect(hit.reason).toBe('history-threshold')

    const firstRunTime = new Date('2026-02-16T00:00:00.000Z')
    const forced = maybeRecomputeSuccessPatterns(gpaiDir, { force: true, now: firstRunTime })
    expect(forced.triggered).toBe(true)

    writeJson(historyPath(), buildHistoryRows(5, 2))
    const cooldown = maybeRecomputeSuccessPatterns(gpaiDir, {
      now: new Date(firstRunTime.getTime() + 30 * 1000)
    })
    expect(cooldown.triggered).toBe(false)
    expect(cooldown.reason).toBe('cooldown')

    const after = maybeRecomputeSuccessPatterns(gpaiDir, {
      now: new Date(firstRunTime.getTime() + 61 * 1000)
    })
    expect(after.triggered).toBe(true)
    expect(after.reason).toBe('rating-threshold')
  })
})
