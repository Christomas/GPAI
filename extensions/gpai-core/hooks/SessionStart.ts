import * as fs from 'fs'
import * as path from 'path'
import { loadMemory } from '../utils/memory'

interface SessionStartInput {
  sessionId: string
  timestamp: number
}

interface SessionStartOutput {
  context: string
  systemPrompt: string
  metadata: Record<string, unknown>
}

interface UserProfile {
  user: {
    name: string
    aiName: string
    email?: string
  }
  mission: string
  goals: string[]
  preferences: {
    communicationStyle: string
    detailLevel?: string
    responseLength?: string
    preferredAgents: string[]
    councilMode: boolean
    learningEnabled: boolean
  }
}

const fallbackProfile: UserProfile = {
  user: {
    name: 'User',
    aiName: 'Kai'
  },
  mission: 'Build safe and reliable systems',
  goals: ['Improve quality', 'Reduce risk', 'Automate repetitive tasks'],
  preferences: {
    communicationStyle: 'direct',
    preferredAgents: ['engineer', 'analyst'],
    councilMode: true,
    learningEnabled: true
  }
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function loadProfile(gpaiDir: string): UserProfile {
  const profilePath = path.join(gpaiDir, 'data/profile.json')
  const fallbackPath = path.join(process.cwd(), 'data/profile.json')
  const targetPath = fs.existsSync(profilePath) ? profilePath : fallbackPath

  if (!fs.existsSync(targetPath)) {
    return fallbackProfile
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as Partial<UserProfile>
    return {
      ...fallbackProfile,
      ...parsed,
      user: {
        ...fallbackProfile.user,
        ...(parsed.user || {})
      },
      preferences: {
        ...fallbackProfile.preferences,
        ...(parsed.preferences || {})
      },
      goals: Array.isArray(parsed.goals) && parsed.goals.length > 0 ? parsed.goals : fallbackProfile.goals
    }
  } catch {
    return fallbackProfile
  }
}

function buildSystemPrompt(profile: UserProfile): string {
  return `You are an intelligent AI assistant helping the user achieve their goals.

User Profile:
- Name: ${profile.user.name}
- AI Name: ${profile.user.aiName}
- Mission: ${profile.mission}
- Goals: ${profile.goals.slice(0, 3).join(', ')}

Instructions:
1. Remember the user's background, preferences, and history
2. Automatically select the most appropriate analysis method
3. Use Council mode (multiple perspectives) for important decisions
4. At the end of each task, ask the user for feedback (1-10 score)
5. Learn from user feedback and improve your approach
6. If the user prefers certain agents, use them by default`
}

function buildContextInjection(profile: UserProfile, hotMemory: any[], warmMemory: any[]): string {
  const timestamp = new Date().toISOString()

  const successfulPatterns = warmMemory
    .filter((entry) => {
      const score = typeof entry.rating === 'number' ? entry.rating : 0
      return entry.type === 'success' || score >= 8
    })
    .slice(0, 3)
    .map((entry) => `- ${entry.content || 'N/A'} [Rating: ${entry.rating || 'N/A'}]`)

  const recentHot = hotMemory
    .slice(-5)
    .map((entry) => `- ${entry.content || 'N/A'}`)
    .join('\n')

  return `
## Session Context (${timestamp})

### User Background
**Mission**: ${profile.mission}
**Current Goals**: ${profile.goals.slice(0, 3).join(', ')}
**Working Style**: ${profile.preferences.communicationStyle}

### Recent Successful Patterns
${successfulPatterns.length > 0 ? successfulPatterns.join('\n') : '- None'}

### Recent Working Memory
${recentHot || '- Empty'}

### Session Guidelines
- Use ${profile.preferences.preferredAgents.join(' + ')} for analysis
- Council mode is ${profile.preferences.councilMode ? 'enabled' : 'disabled'}
- Learning is ${profile.preferences.learningEnabled ? 'enabled' : 'disabled'}
- Communication style: ${profile.preferences.communicationStyle}

---
`
}

export async function handleSessionStart(input: SessionStartInput): Promise<SessionStartOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const profile = loadProfile(gpaiDir)
    const hotMemory = loadMemory(gpaiDir, 'hot', 10)
    const warmMemory = loadMemory(gpaiDir, 'warm', 5)
    const systemPrompt = buildSystemPrompt(profile)
    const context = buildContextInjection(profile, hotMemory, warmMemory)

    return {
      context,
      systemPrompt,
      metadata: {
        sessionId: input.sessionId,
        timestamp: input.timestamp,
        userMission: profile.mission,
        goals: profile.goals.slice(0, 3)
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
