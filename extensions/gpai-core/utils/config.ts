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
  output_contract?: {
    language?: string
    first_visible_char?: string
  }
  [key: string]: any
}

export type OutputLanguage = 'chinese' | 'english' | 'any'

export interface OutputContractConfig {
  language: OutputLanguage
  firstVisibleChar: string
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
        id: 'architect',
        name: 'Architect',
        role: 'System Architect',
        personality: 'Holistic',
        systemPrompt: 'You design system boundaries, trade-offs, and evolution paths.',
        expertise: ['architecture', 'system-design', 'scalability', 'trade-off-analysis'],
        speed: 'balanced',
        responseStyle: 'structured'
      },
      {
        id: 'analyst',
        name: 'Analyst',
        role: 'Risk Analyst',
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
      },
      {
        id: 'planner',
        name: 'Planner',
        role: 'Execution Planner',
        personality: 'Goal-driven',
        systemPrompt: 'You break goals into executable milestones with clear constraints.',
        expertise: ['planning', 'prioritization', 'milestone-design'],
        speed: 'balanced',
        responseStyle: 'actionable'
      },
      {
        id: 'qa',
        name: 'QA',
        role: 'Quality Assurance',
        personality: 'Strict',
        systemPrompt: 'You define test strategy, acceptance criteria, and regression coverage.',
        expertise: ['testing', 'regression', 'acceptance-criteria'],
        speed: 'balanced',
        responseStyle: 'checklist'
      },
      {
        id: 'researcher',
        name: 'Researcher',
        role: 'Evidence Researcher',
        personality: 'Evidence-first',
        systemPrompt: 'You gather high-quality evidence and compare sources before concluding.',
        expertise: ['research', 'fact-checking', 'comparative-analysis'],
        speed: 'thorough',
        responseStyle: 'evidence-based'
      },
      {
        id: 'writer',
        name: 'Writer',
        role: 'Technical Writer',
        personality: 'Clear',
        systemPrompt: 'You turn complex analysis into concise, useful, structured deliverables.',
        expertise: ['technical-writing', 'summarization', 'documentation'],
        speed: 'fast',
        responseStyle: 'clear'
      }
    ],
    intentToAgents: {
      analysis: ['analyst', 'engineer', 'devil'],
      creative: ['writer', 'planner', 'researcher'],
      technical: ['engineer', 'architect', 'qa', 'devil'],
      research: ['researcher', 'analyst', 'writer', 'devil'],
      strategy: ['planner', 'architect', 'analyst', 'devil'],
      security: ['analyst', 'devil', 'engineer', 'qa']
    }
  },
  prompts: {
    intent_detection: {
      prompt:
        'Analyze user request and return JSON: {"intent":"analysis|creative|technical|research|strategy|security","confidence":0-1,"keywords":[]}\\n\\nUser request: {prompt}',
      temperature: 0.3
    },
    output_contract: {
      language: 'chinese',
      first_visible_char: '🗣️'
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

function normalizeOutputLanguage(input: unknown): OutputLanguage {
  if (typeof input !== 'string') {
    return 'chinese'
  }

  const normalized = input.trim().toLowerCase()
  if (normalized === 'chinese' || normalized === 'english' || normalized === 'any') {
    return normalized
  }

  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'cn') {
    return 'chinese'
  }
  if (normalized === 'en' || normalized === 'en-us' || normalized === 'en-gb') {
    return 'english'
  }

  return 'chinese'
}

export function resolveOutputContract(prompts: PromptsConfig | undefined): OutputContractConfig {
  const firstVisibleChar =
    typeof prompts?.output_contract?.first_visible_char === 'string' &&
    prompts.output_contract.first_visible_char.trim().length > 0
      ? prompts.output_contract.first_visible_char.trim()
      : '🗣️'

  return {
    language: normalizeOutputLanguage(prompts?.output_contract?.language),
    firstVisibleChar
  }
}
