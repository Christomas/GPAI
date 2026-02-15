import * as fs from 'fs'
import * as path from 'path'
import { parseSimpleYaml } from '../utils/simpleYaml'

interface BeforeToolInput {
  tool: string
  args: Record<string, unknown>
  context: string
}

interface BeforeToolOutput {
  allowed: boolean
  action: 'allow' | 'block' | 'ask'
  reason?: string
  modifiedArgs?: Record<string, unknown>
}

interface SecurityPatterns {
  security?: {
    blocked?: {
      bash?: string[]
      paths?: string[]
    }
    confirm?: {
      bash?: string[]
      paths?: string[]
    }
    alert?: {
      bash?: string[]
      paths?: string[]
    }
  }
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function expandHome(input: string): string {
  const home = process.env.HOME || ''
  return input.replace(/^~(?=\/|$)/, home).replace(/\$HOME/g, home)
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function matchesPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.trim()
  const normalizedPattern = expandHome(pattern.trim())

  if (normalizedPattern.length === 0) {
    return false
  }

  if (normalizedPattern.includes('*')) {
    return wildcardToRegExp(normalizedPattern).test(normalizedValue)
  }

  return normalizedValue.includes(normalizedPattern)
}

function loadSecurityPatterns(gpaiDir: string): SecurityPatterns {
  const primary = path.join(gpaiDir, 'config/patterns.yaml')
  const fallback = path.join(process.cwd(), 'config/patterns.yaml')
  const target = fs.existsSync(primary) ? primary : fallback

  if (!fs.existsSync(target)) {
    return {}
  }

  try {
    return parseSimpleYaml(fs.readFileSync(target, 'utf-8')) as SecurityPatterns
  } catch {
    return {}
  }
}

function getCommand(args: Record<string, unknown>): string {
  const candidate = args.command || args.cmd
  if (typeof candidate === 'string') {
    return candidate
  }

  return ''
}

function getPathArg(args: Record<string, unknown>): string {
  const candidate = args.path
  if (typeof candidate === 'string') {
    return expandHome(candidate)
  }

  return ''
}

function isBlocked(tool: string, args: Record<string, unknown>, patterns: SecurityPatterns): boolean {
  const blocked = patterns.security?.blocked || {}

  if (tool === 'bash' || tool === 'shell') {
    const command = getCommand(args)
    return (blocked.bash || []).some((pattern) => matchesPattern(command, pattern))
  }

  if (tool === 'filesystem' || tool === 'file') {
    const filePath = getPathArg(args)
    return (blocked.paths || []).some((pattern) => matchesPattern(filePath, pattern))
  }

  return false
}

function requiresConfirmation(
  tool: string,
  args: Record<string, unknown>,
  patterns: SecurityPatterns
): boolean {
  const confirm = patterns.security?.confirm || {}

  if (tool === 'bash' || tool === 'shell') {
    const command = getCommand(args)
    return (confirm.bash || []).some((pattern) => matchesPattern(command, pattern))
  }

  if (tool === 'filesystem' || tool === 'file') {
    const filePath = getPathArg(args)
    return (confirm.paths || []).some((pattern) => matchesPattern(filePath, pattern))
  }

  return false
}

function logSecurityEvent(gpaiDir: string, event: Record<string, unknown>): void {
  const logsDir = path.join(gpaiDir, 'data/logs')
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  const today = new Date().toISOString().split('T')[0]
  const logFile = path.join(logsDir, `security-${today}.jsonl`)
  fs.appendFileSync(logFile, JSON.stringify(event) + '\n')
}

export async function handleBeforeTool(input: BeforeToolInput): Promise<BeforeToolOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const patterns = loadSecurityPatterns(gpaiDir)

    if (isBlocked(input.tool, input.args, patterns)) {
      return {
        allowed: false,
        action: 'block',
        reason: `Operation blocked for security: ${input.tool}`
      }
    }

    if (requiresConfirmation(input.tool, input.args, patterns)) {
      return {
        allowed: false,
        action: 'ask',
        reason: `This operation requires confirmation: ${input.tool} ${JSON.stringify(input.args)}`
      }
    }

    logSecurityEvent(gpaiDir, {
      action: 'allow',
      tool: input.tool,
      args: input.args,
      timestamp: new Date().toISOString()
    })

    return {
      allowed: true,
      action: 'allow',
      modifiedArgs: input.args
    }
  } catch {
    return {
      allowed: true,
      action: 'allow',
      modifiedArgs: input.args
    }
  }
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}') as BeforeToolInput
  handleBeforeTool(input)
    .then((output) => {
      process.stdout.write(JSON.stringify(output))
      process.exit(0)
    })
    .catch((error: Error) => {
      process.stderr.write(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleBeforeTool
