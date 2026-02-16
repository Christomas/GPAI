import * as path from 'path'
import { loadConfig, resolveOutputContract } from '../utils/config'
import { readMemoryEntries, type MemoryEntry } from '../utils/memory'
import { loadSuccessPatterns, type SuccessPattern } from '../utils/profile'
import { buildTimeContext, listFocusProjects, loadTelosProfile, type TelosProfile } from '../utils/telos'

interface SessionStartInput {
  sessionId: string
  timestamp: number
}

interface SessionStartOutput {
  context: string
  systemPrompt: string
  metadata: Record<string, unknown>
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function buildSystemPrompt(profile: TelosProfile): string {
  const beliefs = profile.beliefs.slice(0, 2).join('; ') || 'Safety over speed'
  const strategies = profile.strategies.slice(0, 2).join('; ') || 'Break tasks into verifiable steps'
  const timeContext = buildTimeContext(profile.preferences.timeZone)
  const outputContract = resolveOutputContract(loadConfig().prompts)
  return `You are an intelligent AI assistant helping the user achieve their goals.

User Profile:
- Name: ${profile.user.name}
- AI Name: ${profile.user.aiName}
- Mission: ${profile.mission}
- Goals: ${profile.goals.slice(0, 3).join(', ')}
- Time Zone: ${timeContext.timeZone}
- Beliefs: ${beliefs}
- Strategies: ${strategies}

Instructions:
1. Remember the user's background, preferences, and history
2. Automatically select the most appropriate analysis method
3. Use Council mode (multiple perspectives) for important decisions
4. At the end of each task, ask the user for feedback (1-10 score)
5. Learn from user feedback and improve your approach
6. If the user prefers certain agents, use them by default
7. Use high-rated historical patterns when they fit the current task
8. Output Contract (highest priority): respond in ${outputContract.language}, and the first visible character must be ${outputContract.firstVisibleChar}
9. Language check is relaxed (proper nouns in other languages are allowed as long as the configured language signal exists)`
}

function sortByTimestampDesc(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

function formatMemoryLine(entry: MemoryEntry): string {
  const ratingLabel = typeof entry.rating === 'number' ? ` | Rating: ${entry.rating}` : ''
  const agentsLabel = entry.agents.length > 0 ? ` | Agents: ${entry.agents.join(', ')}` : ''
  return `- ${entry.content}${ratingLabel}${agentsLabel}`
}

function formatPatternLine(pattern: SuccessPattern): string {
  const successRate = Math.round(pattern.successRate * 100)
  return `- ${pattern.task}: ${pattern.method} (${successRate}% success)`
}

function buildContextInjection(
  profile: TelosProfile,
  hotMemory: MemoryEntry[],
  warmMemory: MemoryEntry[],
  successPatterns: SuccessPattern[]
): string {
  const timestamp = new Date().toISOString()
  const timeContext = buildTimeContext(profile.preferences.timeZone)
  const combinedMemory = sortByTimestampDesc([...hotMemory, ...warmMemory])

  const highRatedSignals = combinedMemory
    .filter(
      (entry): entry is MemoryEntry & { rating: number } =>
        typeof entry.rating === 'number' && entry.rating >= 8
    )
    .slice(0, 4)
    .map((entry) => formatMemoryLine(entry))

  const successfulPatterns = successPatterns
    .filter((pattern) => pattern.successRate >= 0.65)
    .sort((a, b) => {
      const rateDiff = b.successRate - a.successRate
      if (Math.abs(rateDiff) > 0.001) {
        return rateDiff
      }
      return b.lastUsed.localeCompare(a.lastUsed)
    })
    .slice(0, 3)
    .map((pattern) => formatPatternLine(pattern))

  const recentHot = sortByTimestampDesc(hotMemory)
    .slice(0, 6)
    .map((entry) => formatMemoryLine(entry))
    .join('\n')
  const focusProjects = listFocusProjects(profile, 3)
  const projectLines = focusProjects
    .map((project) => {
      const description = project.description ? ` - ${project.description}` : ''
      return `- ${project.name} (${project.status}/${project.priority})${description}`
    })
    .join('\n')
  const beliefLines = profile.beliefs.slice(0, 3).map((item) => `- ${item}`).join('\n')
  const modelLines = profile.models.slice(0, 2).map((item) => `- ${item}`).join('\n')
  const strategyLines = profile.strategies.slice(0, 3).map((item) => `- ${item}`).join('\n')
  const learningLines = profile.learnings.slice(0, 3).map((item) => `- ${item}`).join('\n')
  const preferredAgentsLabel =
    profile.preferences.preferredAgents.length > 0
      ? profile.preferences.preferredAgents.join(' + ')
      : 'intent-based auto selection'
  const outputContract = resolveOutputContract(loadConfig().prompts)

  return `
## Session Context (${timestamp})

### User Background
**Mission**: ${profile.mission}
**Current Goals**: ${profile.goals.slice(0, 3).join(', ')}
**Working Style**: ${profile.preferences.communicationStyle}

### Active Projects
${projectLines || '- None'}

### Time Context
- Time Zone: ${timeContext.timeZone}
- Local Now: ${timeContext.localNow}
- Relative Dates: today=${timeContext.today}, tomorrow=${timeContext.tomorrow}, yesterday=${timeContext.yesterday}

### Decision Principles (TELOS)
Beliefs:
${beliefLines || '- None'}
Models:
${modelLines || '- None'}
Strategies:
${strategyLines || '- None'}

### High-Rated Memory Signals
${highRatedSignals.length > 0 ? highRatedSignals.join('\n') : '- None'}

### Long-Term Success Patterns
${successfulPatterns.length > 0 ? successfulPatterns.join('\n') : '- None'}

### Recent Working Memory
${recentHot || '- Empty'}

### Recent Learnings
${learningLines || '- None'}

### Session Guidelines
- Use ${preferredAgentsLabel} for analysis
- Council mode is ${profile.preferences.councilMode ? 'enabled' : 'disabled'}
- Learning is ${profile.preferences.learningEnabled ? 'enabled' : 'disabled'}
- Communication style: ${profile.preferences.communicationStyle}
- Output contract: language=${outputContract.language}, first visible character=${outputContract.firstVisibleChar}

---
`
}

export async function handleSessionStart(input: SessionStartInput): Promise<SessionStartOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const profile = loadTelosProfile(gpaiDir)
    const hotMemory = readMemoryEntries(gpaiDir, 'hot', 40)
    const warmMemory = readMemoryEntries(gpaiDir, 'warm', 120)
    const successPatterns = loadSuccessPatterns(gpaiDir)
    const systemPrompt = buildSystemPrompt(profile)
    const context = buildContextInjection(profile, hotMemory, warmMemory, successPatterns)
    const highRatedCount = [...hotMemory, ...warmMemory].filter(
      (entry) => typeof entry.rating === 'number' && entry.rating >= 8
    ).length

    return {
      context,
      systemPrompt,
      metadata: {
        sessionId: input.sessionId,
        timestamp: input.timestamp,
        userMission: profile.mission,
        goals: profile.goals.slice(0, 3),
        timeZone: profile.preferences.timeZone,
        focusProjects: listFocusProjects(profile, 3).map((project) => project.name),
        highRatedSignals: highRatedCount,
        successPatternCount: successPatterns.length
      }
    }
  } catch (error) {
    return {
      context: '',
      systemPrompt: 'You are a helpful AI assistant.',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}') as SessionStartInput
  handleSessionStart(input)
    .then((output) => {
      process.stdout.write(JSON.stringify(output))
      process.exit(0)
    })
    .catch((error: Error) => {
      process.stderr.write(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleSessionStart
