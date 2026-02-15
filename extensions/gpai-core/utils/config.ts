import * as fs from 'fs'
import * as path from 'path'
import { parseSimpleYaml } from './simpleYaml'

export interface AgentsConfig {
  agents: Array<{
    id: string
    name: string
    role: string
    personality: string
    systemPrompt: string
    expertise: string[]
    speed: string
    responseStyle: string
  }>
  intentToAgents: Record<string, string[]>
}

export interface PromptsConfig {
  intent_detection: {
    prompt: string
    temperature: number
  }
  [key: string]: any
}

export interface AppConfig {
  agents: AgentsConfig
  prompts: PromptsConfig
  patterns: any
}

const defaultConfig: AppConfig = {
  agents: {
    agents: [
      {
        id: 'engineer',
        name: 'Engineer',
        role: 'Technical Expert',
        personality: 'Pragmatic',
        systemPrompt: 'You are a senior software engineer focused on correctness and safety.',
        expertise: ['coding', 'debugging', 'architecture'],
        speed: 'fast',
        responseStyle: 'technical'
      },
      {
        id: 'analyst',
        name: 'Analyst',
        role: 'Security Analyst',
        personality: 'Systematic',
        systemPrompt: 'You are a security analyst who identifies risks and mitigations.',
        expertise: ['security', 'analysis', 'risk-assessment'],
        speed: 'thorough',
        responseStyle: 'analytical'
      },
      {
        id: 'devil',
        name: 'Devil',
        role: 'Critical Thinker',
        personality: 'Skeptical',
        systemPrompt: 'You challenge assumptions and identify blind spots.',
        expertise: ['critical-thinking', 'threat-modeling'],
        speed: 'fast',
        responseStyle: 'critical'
      }
    ],
    intentToAgents: {
      analysis: ['analyst', 'engineer', 'devil'],
      creative: ['engineer'],
      technical: ['engineer', 'devil'],
      research: ['analyst', 'devil'],
      strategy: ['analyst', 'engineer'],
      security: ['analyst', 'devil', 'engineer']
    }
  },
  prompts: {
    intent_detection: {
      prompt:
        'Analyze user request and return JSON: {"intent":"analysis|creative|technical|research|strategy|security","confidence":0-1,"keywords":[]}\\n\\nUser request: {prompt}',
      temperature: 0.3
    }
  },
  patterns: {
    security: {
      blocked: {
        bash: ['rm -rf /', 'dd if=/dev/zero', 'mkfs'],
        paths: ['~/.ssh/*', '/etc/shadow']
      },
      confirm: {
        bash: ['git push --force', 'rm -rf', 'sudo'],
        paths: ['~/.*', '/etc/*']
      },
      alert: {
        bash: ['curl', 'wget', 'ssh'],
        paths: ['/root/*']
      }
    }
  }
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function readJsonFile(filePath: string): any | null {
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

function readYamlFile(filePath: string): any | null {
  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    return parseSimpleYaml(content)
  } catch {
    return null
  }
}

function selectFile(fileName: string): string {
  const gpaiDir = resolveGpaiDir()
  const candidates = [
    path.join(gpaiDir, 'config', fileName),
    path.join(process.cwd(), 'config', fileName)
  ]

  const found = candidates.find((candidate) => fs.existsSync(candidate))
  return found || candidates[0]
}

export function loadConfig(): AppConfig {
  const agents = readJsonFile(selectFile('agents.json')) || defaultConfig.agents
  const prompts = readJsonFile(selectFile('prompts.json')) || defaultConfig.prompts
  const patterns = readYamlFile(selectFile('patterns.yaml')) || defaultConfig.patterns

  return {
    agents,
    prompts,
    patterns
  }
}

export function resolveConfigPath(relativePath: string): string {
  const gpaiDir = resolveGpaiDir()
  const candidate = path.join(gpaiDir, relativePath)
  if (fs.existsSync(candidate)) {
    return candidate
  }

  return path.join(process.cwd(), relativePath)
}
