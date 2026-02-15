import * as fs from 'fs'
import * as path from 'path'
import { selectAgents } from './agents'
import { Agent, AgentSelectionInput } from './types'

interface Command {
  intent: string
}

function resolveAgentsConfigPath(): string {
  const gpaiDir = process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
  const primary = path.join(gpaiDir, 'config/agents.json')
  const fallback = path.join(process.cwd(), 'config/agents.json')
  return fs.existsSync(primary) ? primary : fallback
}

function loadAgentsConfig(): AgentSelectionInput {
  const target = resolveAgentsConfigPath()
  const raw = JSON.parse(fs.readFileSync(target, 'utf-8')) as {
    agents: Agent[]
    intentToAgents: Record<string, string[]>
  }

  return {
    intent: 'analysis',
    available: raw.agents,
    mapping: raw.intentToAgents
  }
}

function run(command: Command): Agent[] {
  const config = loadAgentsConfig()
  return selectAgents({ ...config, intent: command.intent })
}

if (require.main === module) {
  const raw = process.argv[2]
  if (!raw) {
    process.stderr.write('Usage: node index.js "{\\"intent\\":\\"security\\"}"\n')
    process.exit(1)
  }

  const command = JSON.parse(raw) as Command
  try {
    const agents = run(command)
    process.stdout.write(JSON.stringify(agents))
    process.exit(0)
  } catch (error) {
    process.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })
    )
    process.exit(1)
  }
}
