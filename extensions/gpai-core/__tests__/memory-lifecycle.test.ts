import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { PRECOMPRESS_POLICY, handlePreCompress } from '../hooks/PreCompress'
import { handleSessionStart } from '../hooks/SessionStart'
import { readJsonl } from '../utils/memory'

type MemoryRow = Record<string, unknown>

function writeJsonl(filePath: string, rows: MemoryRow[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (rows.length === 0) {
    fs.writeFileSync(filePath, '')
    return
  }

  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
}

describe('Memory lifecycle', () => {
  const fixtureGpaiDir = path.resolve(__dirname, '../../../test-data/.gpai')
  let runtimeGpaiDir = ''

  function memoryPath(tier: 'hot' | 'warm' | 'cold'): string {
    return path.join(runtimeGpaiDir, `data/memory/${tier}.jsonl`)
  }

  beforeEach(() => {
    runtimeGpaiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpai-memory-'))
    fs.cpSync(fixtureGpaiDir, runtimeGpaiDir, { recursive: true })
    process.env.GPAI_DIR = runtimeGpaiDir
    writeJsonl(memoryPath('hot'), [])
    writeJsonl(memoryPath('warm'), [])
    writeJsonl(memoryPath('cold'), [])
  })

  afterEach(() => {
    delete process.env.GPAI_DIR
    if (runtimeGpaiDir) {
      fs.rmSync(runtimeGpaiDir, { recursive: true, force: true })
    }
  })

  it('should include high-rated memory and success patterns on session start', async () => {
    const profilePath = path.join(runtimeGpaiDir, 'data/profile.json')
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as Record<string, unknown>

    profile.successPatterns = [
      {
        task: 'analysis',
        method: 'analyst + engineer',
        successRate: 0.9,
        lastUsed: '2026-02-15T12:00:00.000Z',
        sampleSize: 6
      }
    ]
    profile.projects = [
      {
        name: 'Incident Response',
        description: 'security workflow',
        status: 'in-progress',
        priority: 'high'
      }
    ]
    profile.beliefs = ['Security first']
    profile.models = ['Risk-first thinking']
    profile.strategies = ['Multi-perspective review']
    profile.learnings = ['OSINT timeline is useful']

    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2))

    writeJsonl(memoryPath('hot'), [
      {
        type: 'task_result',
        content: 'Found high-impact auth bug',
        rating: 9,
        agents: ['analyst'],
        timestamp: '2026-02-16T01:00:00.000Z'
      }
    ])

    writeJsonl(memoryPath('warm'), [
      {
        type: 'feedback',
        content: 'analyst + engineer worked well',
        rating: 8,
        agents: ['analyst', 'engineer'],
        timestamp: '2026-02-15T23:00:00.000Z'
      }
    ])

    const result = await handleSessionStart({
      sessionId: 'session-memory-context',
      timestamp: Date.now()
    })

    expect(result.context).toContain('High-Rated Memory Signals')
    expect(result.context).toContain('Decision Principles (TELOS)')
    expect(result.context).toContain('Active Projects')
    expect(result.context).toContain('Time Context')
    expect(result.context).toContain('Long-Term Success Patterns')
    expect(result.context).toContain('analyst + engineer')
    expect((result.metadata.successPatternCount as number) || 0).toBeGreaterThanOrEqual(1)
  })

  it('should rotate hot/warm/cold memory tiers with retention limits', async () => {
    const now = Date.now()
    const hotOverflow = 5
    const warmOld = 2
    const warmOverflow = 3

    const hotEntries: MemoryRow[] = Array.from(
      { length: PRECOMPRESS_POLICY.hotKeepCount + hotOverflow },
      (_, index) => ({
        type: 'implicit_signal',
        content: `hot-entry-${index}`,
        timestamp: new Date(now - (PRECOMPRESS_POLICY.hotKeepCount + hotOverflow - index) * 60_000).toISOString()
      })
    )

    const warmStaleEntries: MemoryRow[] = Array.from({ length: warmOld }, (_, index) => ({
      type: 'task_result',
      content: `warm-stale-${index}`,
      timestamp: new Date(
        now - (PRECOMPRESS_POLICY.warmRetentionDays + 5 + index) * 24 * 60 * 60 * 1000
      ).toISOString()
    }))

    const warmRecentEntries: MemoryRow[] = Array.from(
      { length: PRECOMPRESS_POLICY.warmMaxCount + warmOverflow },
      (_, index) => ({
        type: 'task_result',
        content: `warm-recent-${index}`,
        timestamp: new Date(now - (PRECOMPRESS_POLICY.warmMaxCount + warmOverflow - index) * 60_000).toISOString()
      })
    )

    const coldBaseEntries: MemoryRow[] = Array.from(
      { length: PRECOMPRESS_POLICY.coldMaxCount - 4 },
      (_, index) => ({
        type: 'archive',
        content: `cold-entry-${index}`,
        timestamp: new Date(now - (120 + index) * 24 * 60 * 60 * 1000).toISOString()
      })
    )

    writeJsonl(memoryPath('hot'), hotEntries)
    writeJsonl(memoryPath('warm'), [...warmStaleEntries, ...warmRecentEntries])
    writeJsonl(memoryPath('cold'), coldBaseEntries)

    const result = await handlePreCompress({
      sessionId: 'session-precompress',
      tokenUsage: 10,
      maxTokens: 100
    })

    const expectedWarmToCold = warmOld + hotOverflow + warmOverflow
    const expectedColdPruned = expectedWarmToCold - 4

    expect(result.archivedCount).toBe(hotOverflow)
    expect(result.metadata.hotToWarmCount).toBe(hotOverflow)
    expect(result.metadata.warmToColdCount).toBe(expectedWarmToCold)
    expect(result.metadata.coldPrunedCount).toBe(expectedColdPruned)
    expect(result.metadata.finalHotCount).toBe(PRECOMPRESS_POLICY.hotKeepCount)
    expect(result.metadata.finalWarmCount).toBe(PRECOMPRESS_POLICY.warmMaxCount)
    expect(result.metadata.finalColdCount).toBe(PRECOMPRESS_POLICY.coldMaxCount)

    expect(readJsonl(memoryPath('hot')).length).toBe(PRECOMPRESS_POLICY.hotKeepCount)
    expect(readJsonl(memoryPath('warm')).length).toBe(PRECOMPRESS_POLICY.warmMaxCount)
    expect(readJsonl(memoryPath('cold')).length).toBe(PRECOMPRESS_POLICY.coldMaxCount)
  })
})
