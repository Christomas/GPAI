import * as fs from 'fs'
import * as path from 'path'
import { callGemini } from '../utils/gemini'
import { loadConfig } from '../utils/config'
import { readJsonl } from '../utils/memory'

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

interface WorkItem {
  id: string
  prompt: string
  intent: string
  createdAt: string
  status: 'in-progress' | 'completed' | 'failed'
  agents: string[]
}

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

function selectAgents(intent: string): string[] {
  const config = loadConfig()
  const mapping = config.agents.intentToAgents
  return mapping[intent] || ['engineer', 'analyst']
}

function createWorkItem(gpaiDir: string, prompt: string, intent: string): WorkItem {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const workDir = path.join(gpaiDir, `data/work/${timestamp}_work`)

  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true })
  }

  const workItem: WorkItem = {
    id: timestamp,
    prompt,
    intent,
    createdAt: new Date().toISOString(),
    status: 'in-progress',
    agents: selectAgents(intent)
  }

  fs.writeFileSync(path.join(workDir, 'META.json'), JSON.stringify(workItem, null, 2))
  return workItem
}

function retrieveRelevantMemory(gpaiDir: string, prompt: string): string {
  const keywords = prompt
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 3)

  if (keywords.length === 0) {
    return ''
  }

  const warmPath = path.join(gpaiDir, 'data/memory/warm.jsonl')
  const fallbackPath = path.join(process.cwd(), 'data/memory/warm.jsonl')
  const targetPath = fs.existsSync(warmPath) ? warmPath : fallbackPath

  if (!fs.existsSync(targetPath)) {
    return ''
  }

  const entries = readJsonl(targetPath)
  const matches = entries.filter((entry) => {
    const content = String(entry.content || '').toLowerCase()
    return keywords.some((keyword) => content.includes(keyword))
  })

  return matches
    .slice(0, 3)
    .map((entry) => `- ${entry.content || 'N/A'} [Rating: ${entry.rating || 'N/A'}]`)
    .join('\n')
}

function generateSystemInstructions(agents: string[], intent: string): string {
  const config = loadConfig()
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

Process:
1. Each role analyzes independently
2. Share perspectives
3. Synthesize the best answer from all viewpoints
4. If in Council mode, use discussion format`
}

function buildModifiedPrompt(prompt: string, agents: string[], intent: string): string {
  return `${prompt}

[System Guidance]
- Task Type: ${intent}
- Recommended Agents: ${agents.join(', ')}
- Use Council mode for multi-perspective analysis
- After completion, request user feedback (1-10 score)`
}

export async function handleBeforeAgent(input: BeforeAgentInput): Promise<BeforeAgentOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const intent = await analyzeIntent(input.prompt)
    const suggestedAgents = selectAgents(intent)

    createWorkItem(gpaiDir, input.prompt, intent)
    const relevantMemory = retrieveRelevantMemory(gpaiDir, input.prompt)
    const systemInstructions = generateSystemInstructions(suggestedAgents, intent)
    const modifiedPrompt = buildModifiedPrompt(input.prompt, suggestedAgents, intent)

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
