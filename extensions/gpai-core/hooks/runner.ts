import * as fs from 'fs'
import * as path from 'path'

type HookEvent =
  | 'SessionStart'
  | 'BeforeAgent'
  | 'BeforeTool'
  | 'AfterTool'
  | 'AfterAgent'
  | 'PreCompress'

interface GenericHookInput {
  hook_event_name?: HookEvent
  session_id?: string
  timestamp?: string
  prompt?: string
  prompt_response?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: Record<string, unknown>
  cwd?: string
  [key: string]: unknown
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

function parseInput(payload: string): GenericHookInput {
  if (!payload.trim()) {
    return {}
  }

  try {
    return JSON.parse(payload) as GenericHookInput
  } catch {
    return {}
  }
}

function logHookEvent(eventName: HookEvent, input: GenericHookInput, output: unknown): void {
  try {
    const gpaiDir = resolveGpaiDir()
    const logsDir = path.join(gpaiDir, 'data/logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }

    const date = new Date().toISOString().slice(0, 10)
    const logPath = path.join(logsDir, `hooks-${date}.jsonl`)

    const record = {
      timestamp: new Date().toISOString(),
      event: eventName,
      sessionId: input.session_id || null,
      summary: {
        promptLength: typeof input.prompt === 'string' ? input.prompt.length : 0,
        tool: input.tool_name || null
      },
      output
    }

    fs.appendFileSync(logPath, JSON.stringify(record) + '\n')
  } catch {
    // No-op: logging should never fail hook execution.
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

async function routeEvent(eventName: HookEvent, input: GenericHookInput): Promise<Record<string, unknown>> {
  switch (eventName) {
    case 'SessionStart': {
      const { handleSessionStart } = await import('./SessionStart')
      const session = await handleSessionStart({
        sessionId: input.session_id || 'unknown-session',
        timestamp: Date.now()
      })

      return {
        decision: 'allow',
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `${session.systemPrompt}\n\n${session.context}`.trim()
        }
      }
    }

    case 'BeforeAgent': {
      const { handleBeforeAgent } = await import('./BeforeAgent')
      const result = await handleBeforeAgent({
        prompt: asString(input.prompt),
        sessionId: input.session_id || 'unknown-session',
        conversationHistory: []
      })

      const context = [result.systemInstructions, result.injectedContext]
        .filter((part) => part && part.trim().length > 0)
        .join('\n\n')

      return {
        decision: 'allow',
        hookSpecificOutput: {
          hookEventName: 'BeforeAgent',
          additionalContext: context
        }
      }
    }

    case 'BeforeTool': {
      const { handleBeforeTool } = await import('./BeforeTool')
      const result = await handleBeforeTool({
        tool: input.tool_name || 'unknown-tool',
        args: (input.tool_input || {}) as Record<string, unknown>,
        context: ''
      })

      if (result.action === 'block') {
        return {
          decision: 'block',
          reason: result.reason || 'Blocked by GPAI security policy.'
        }
      }

      if (result.action === 'ask') {
        return {
          decision: 'ask',
          reason: result.reason || 'Confirmation required by GPAI policy.'
        }
      }

      return {
        decision: 'allow',
        hookSpecificOutput: {
          hookEventName: 'BeforeTool',
          tool_input: result.modifiedArgs || input.tool_input || {}
        }
      }
    }

    case 'AfterTool': {
      const { handleAfterTool } = await import('./AfterTool')
      const result = await handleAfterTool({
        tool: input.tool_name || 'unknown-tool',
        result: input.tool_response || {},
        executionTime: 0,
        args: (input.tool_input || {}) as Record<string, unknown>
      })

      return {
        decision: 'allow',
        hookSpecificOutput: {
          hookEventName: 'AfterTool',
          additionalContext: `Tool ${input.tool_name || 'unknown-tool'} executed and captured in GPAI memory.`
        },
        systemMessage: JSON.stringify(result.metadata)
      }
    }

    case 'AfterAgent': {
      const { handleAfterAgent } = await import('./AfterAgent')
      const result = await handleAfterAgent({
        result: asString(input.prompt_response),
        executionTime: 0,
        tools_used: [],
        model_calls: 0,
        success: true
      })

      return {
        decision: 'allow',
        systemMessage: result.message
      }
    }

    case 'PreCompress': {
      const { handlePreCompress } = await import('./PreCompress')
      const result = await handlePreCompress({
        sessionId: input.session_id || 'unknown-session',
        tokenUsage: 0,
        maxTokens: 1
      })

      return {
        decision: 'allow',
        systemMessage: `PreCompress archived ${result.archivedCount} entries.`
      }
    }
  }
}

async function main(): Promise<void> {
  const argEvent = process.argv[2] as HookEvent | undefined
  const stdinPayload = await readStdin()
  const input = parseInput(stdinPayload)
  const eventName = argEvent || input.hook_event_name

  if (!eventName) {
    process.stdout.write(JSON.stringify({ decision: 'allow' }))
    return
  }

  const output = await routeEvent(eventName, input)
  logHookEvent(eventName, input, output)
  process.stdout.write(JSON.stringify(output))
}

main().catch((error: Error) => {
  process.stderr.write(JSON.stringify({ error: error.message }))
  process.exit(1)
})
