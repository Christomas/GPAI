/**
 * GPAI root entry.
 *
 * This file intentionally avoids ESM import/export syntax so Node.js can run it
 * in CommonJS mode without MODULE_TYPELESS_PACKAGE_JSON warnings.
 *
 * It also provides a minimal MCP stdio-compatible server to avoid EOF during
 * `initialize` when tools like Antigravity probe this path as an MCP endpoint.
 */

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: Record<string, unknown>
  error?: {
    code: number
    message: string
  }
}

const SERVER_INFO = {
  name: 'gpai-core',
  version: '1.0.0'
}

const fs = require('fs') as typeof import('fs')
const path = require('path') as typeof import('path')

type HookEvent = 'SessionStart' | 'BeforeAgent' | 'BeforeTool' | 'AfterTool' | 'AfterAgent' | 'PreCompress'

const EXPOSED_TOOLS = [
  {
    name: 'gpai_health',
    description: 'Health check for GPAI MCP bridge.',
    inputSchema: {
      type: 'object',
      properties: {
        echo: {
          type: 'string',
          description: 'Optional echo content.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'gpai_run_hook',
    description: 'Run GPAI core hook logic (SessionStart/BeforeAgent/BeforeTool/AfterTool/AfterAgent/PreCompress).',
    inputSchema: {
      type: 'object',
      properties: {
        event: {
          type: 'string',
          enum: ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent', 'PreCompress']
        },
        payload: {
          type: 'object',
          description: 'Hook input payload. Field names support both camelCase and snake_case.'
        }
      },
      required: ['event'],
      additionalProperties: false
    }
  },
  {
    name: 'gpai_auto_pipeline',
    description:
      'Run GPAI pipeline in one call: SessionStart -> BeforeAgent -> (BeforeTool/AfterTool)* -> AfterAgent -> PreCompress.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Session id.'
        },
        timestamp: {
          type: 'number',
          description: 'Optional session timestamp in milliseconds.'
        },
        prompt: {
          type: 'string',
          description: 'User prompt for BeforeAgent/AfterAgent.'
        },
        conversationHistory: {
          type: 'array',
          description: 'Optional conversation history.',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              content: { type: 'string' }
            },
            required: ['role', 'content'],
            additionalProperties: true
          }
        },
        toolExecutions: {
          type: 'array',
          description: 'Optional tool execution traces for BeforeTool/AfterTool.',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              tool_name: { type: 'string' },
              args: { type: 'object' },
              tool_input: { type: 'object' },
              result: {},
              tool_response: {},
              executionTime: { type: 'number' },
              execution_time: { type: 'number' }
            },
            additionalProperties: true
          }
        },
        result: {
          type: 'string',
          description: 'Final assistant response for AfterAgent.'
        },
        success: {
          type: 'boolean',
          description: 'Optional explicit success status for AfterAgent.'
        },
        error: {
          description: 'Optional error payload for AfterAgent.'
        },
        modelCalls: {
          type: 'number',
          description: 'Optional model call count for AfterAgent.'
        },
        executionTime: {
          type: 'number',
          description: 'Optional total execution time (ms) for AfterAgent.'
        },
        runAfterAgent: {
          type: 'boolean',
          description: 'Whether to run AfterAgent. Default true.'
        },
        runSessionStart: {
          type: 'boolean',
          description: 'Whether to run SessionStart. Default true.'
        },
        runBeforeAgent: {
          type: 'boolean',
          description: 'Whether to run BeforeAgent. Default true.'
        },
        runToolStages: {
          type: 'boolean',
          description: 'Whether to run BeforeTool/AfterTool stages from toolExecutions. Default true.'
        },
        runPreCompress: {
          type: 'boolean',
          description: 'Whether to evaluate PreCompress trigger. Default true.'
        },
        forcePreCompress: {
          type: 'boolean',
          description: 'Force run PreCompress regardless of token usage.'
        },
        tokenUsage: {
          type: 'number',
          description: 'Current token usage for PreCompress trigger.'
        },
        maxTokens: {
          type: 'number',
          description: 'Context token limit for PreCompress trigger.'
        },
        preCompressRatio: {
          type: 'number',
          description: 'Trigger threshold ratio for PreCompress. Default 0.85.'
        }
      },
      additionalProperties: true
    }
  }
] as const

let readBuffer = Buffer.alloc(0)
let initialized = false
let outputMode: 'framed' | 'raw' = 'framed'

function errorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function tryAppendLog(filePath: string, payload: Record<string, unknown>): boolean {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`)
    return true
  } catch (error) {
    if (process.env.GPAI_MCP_LOG_DEBUG === '1') {
      const message = error instanceof Error ? error.message : 'unknown error'
      process.stderr.write(`[gpai-mcp-log] failed: ${filePath} | ${message}\n`)
    }
    return false
  }
}

function appendMcpLog(record: Record<string, unknown>): void {
  const date = new Date().toISOString().slice(0, 10)
  const payload = {
    timestamp: new Date().toISOString(),
    ...record
  }

  const gpaiPrimary = path.join(resolveGpaiDir(), 'data/logs', `mcp-tools-${date}.jsonl`)
  if (tryAppendLog(gpaiPrimary, payload)) {
    return
  }

  const cwdFallback = path.join(process.cwd(), '.gpai/data/logs', `mcp-tools-${date}.jsonl`)
  if (cwdFallback !== gpaiPrimary && tryAppendLog(cwdFallback, payload)) {
    return
  }

  // Last-resort fallback for sandboxed environments where ~/.gpai is not writable.
  tryAppendLog(path.join('/tmp', `gpai-mcp-tools-${date}.jsonl`), payload)
}

appendMcpLog({
  category: 'mcp-runtime',
  phase: 'startup',
  pid: process.pid,
  cwd: process.cwd(),
  gpaiDir: resolveGpaiDir()
})

process.on('uncaughtException', (error) => {
  appendMcpLog({
    category: 'mcp-runtime',
    phase: 'uncaughtException',
    message: errorMessage(error),
    stack: error instanceof Error ? error.stack : undefined
  })
})

process.on('unhandledRejection', (reason) => {
  appendMcpLog({
    category: 'mcp-runtime',
    phase: 'unhandledRejection',
    message: errorMessage(reason)
  })
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getString(payload: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'string') {
      return value
    }
  }
  return fallback
}

function getNumber(payload: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return fallback
}

function getBoolean(
  payload: Record<string, unknown>,
  keys: string[],
  fallback: boolean | undefined = undefined
): boolean | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === 'boolean') {
      return value
    }
  }
  return fallback
}

function getStringArray(payload: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string')
    }
  }
  return []
}

function getConversationHistory(
  payload: Record<string, unknown>
): Array<{ role: string; content: string }> {
  const source = payload.conversationHistory || payload.conversation_history
  if (!Array.isArray(source)) {
    return []
  }

  return source
    .map((item) => asRecord(item))
    .filter((item) => typeof item.role === 'string' && typeof item.content === 'string')
    .map((item) => ({
      role: String(item.role),
      content: String(item.content)
    }))
}

function getHookEvent(raw: unknown): HookEvent | null {
  if (typeof raw !== 'string') {
    return null
  }

  if (
    raw === 'SessionStart' ||
    raw === 'BeforeAgent' ||
    raw === 'BeforeTool' ||
    raw === 'AfterTool' ||
    raw === 'AfterAgent' ||
    raw === 'PreCompress'
  ) {
    return raw
  }

  return null
}

function normalizeErrorPayload(value: unknown): { message?: string } | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return { message: value.trim() }
  }

  if (value && typeof value === 'object') {
    const payload = value as Record<string, unknown>
    if (typeof payload.message === 'string') {
      return { message: payload.message }
    }
    return payload as { message?: string }
  }

  return undefined
}

interface ToolExecutionInput {
  tool: string
  args: Record<string, unknown>
  result: unknown
  executionTime: number
}

function getToolExecutions(payload: Record<string, unknown>): ToolExecutionInput[] {
  const source = payload.toolExecutions || payload.tool_executions
  if (!Array.isArray(source)) {
    return []
  }

  return source.map((row) => {
    const item = asRecord(row)
    return {
      tool: getString(item, ['tool', 'tool_name'], 'unknown-tool'),
      args: asRecord(item.args || item.tool_input),
      result: Object.prototype.hasOwnProperty.call(item, 'result')
        ? item.result
        : Object.prototype.hasOwnProperty.call(item, 'tool_response')
          ? item.tool_response
          : {},
      executionTime: getNumber(item, ['executionTime', 'execution_time'])
    }
  })
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((item) => typeof item === 'string' && item.trim().length > 0))]
}

function normalizeRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}

async function runHook(event: HookEvent, payload: Record<string, unknown>): Promise<unknown> {
  switch (event) {
    case 'SessionStart': {
      const { handleSessionStart } = require('./hooks/SessionStart') as {
        handleSessionStart: (input: { sessionId: string; timestamp: number }) => Promise<unknown>
      }
      return handleSessionStart({
        sessionId: getString(payload, ['sessionId', 'session_id'], 'mcp-session'),
        timestamp: getNumber(payload, ['timestamp'], Date.now())
      })
    }
    case 'BeforeAgent': {
      const { handleBeforeAgent } = require('./hooks/BeforeAgent') as {
        handleBeforeAgent: (input: {
          prompt: string
          sessionId: string
          conversationHistory: Array<{ role: string; content: string }>
        }) => Promise<unknown>
      }
      return handleBeforeAgent({
        prompt: getString(payload, ['prompt']),
        sessionId: getString(payload, ['sessionId', 'session_id'], 'mcp-session'),
        conversationHistory: getConversationHistory(payload)
      })
    }
    case 'BeforeTool': {
      const { handleBeforeTool } = require('./hooks/BeforeTool') as {
        handleBeforeTool: (input: {
          tool: string
          args: Record<string, unknown>
          context: string
        }) => Promise<unknown>
      }
      return handleBeforeTool({
        tool: getString(payload, ['tool', 'tool_name'], 'unknown-tool'),
        args: asRecord(payload.args || payload.tool_input),
        context: getString(payload, ['context'], '')
      })
    }
    case 'AfterTool': {
      const { handleAfterTool } = require('./hooks/AfterTool') as {
        handleAfterTool: (input: {
          tool: string
          result: Record<string, unknown>
          executionTime: number
          args: Record<string, unknown>
        }) => Promise<unknown>
      }
      return handleAfterTool({
        tool: getString(payload, ['tool', 'tool_name'], 'unknown-tool'),
        result: asRecord(payload.result || payload.tool_response),
        executionTime: getNumber(payload, ['executionTime', 'execution_time']),
        args: asRecord(payload.args || payload.tool_input)
      })
    }
    case 'AfterAgent': {
      const { handleAfterAgent } = require('./hooks/AfterAgent') as {
        handleAfterAgent: (input: {
          sessionId?: string
          prompt: string
          result: string
          executionTime: number
          tools_used: string[]
          model_calls: number
          success: boolean
          error?: { message?: string }
        }) => Promise<unknown>
      }
      const errorValue = payload.error
      let normalizedError: { message?: string } | undefined
      if (typeof errorValue === 'string') {
        normalizedError = { message: errorValue }
      } else if (errorValue && typeof errorValue === 'object') {
        normalizedError = errorValue as { message?: string }
      }

      const success = getBoolean(payload, ['success'], normalizedError ? false : true) ?? true
      return handleAfterAgent({
        sessionId: getString(payload, ['sessionId', 'session_id']) || undefined,
        prompt: getString(payload, ['prompt']),
        result: getString(payload, ['result', 'prompt_response']),
        executionTime: getNumber(payload, ['executionTime', 'execution_time']),
        tools_used: getStringArray(payload, ['tools_used', 'toolsUsed']),
        model_calls: getNumber(payload, ['model_calls', 'modelCalls']),
        success,
        error: normalizedError
      })
    }
    case 'PreCompress': {
      const { handlePreCompress } = require('./hooks/PreCompress') as {
        handlePreCompress: (input: {
          sessionId: string
          tokenUsage: number
          maxTokens: number
        }) => Promise<unknown>
      }
      return handlePreCompress({
        sessionId: getString(payload, ['sessionId', 'session_id'], 'mcp-session'),
        tokenUsage: getNumber(payload, ['tokenUsage', 'token_usage']),
        maxTokens: getNumber(payload, ['maxTokens', 'max_tokens'], 1)
      })
    }
  }
}

async function runAutoPipeline(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sessionId = getString(args, ['sessionId', 'session_id'], 'mcp-session')
  const timestamp = getNumber(args, ['timestamp'], Date.now())
  const prompt = getString(args, ['prompt'])
  const conversationHistory = getConversationHistory(args)
  const toolExecutions = getToolExecutions(args)
  const explicitTools = getStringArray(args, ['toolsUsed', 'tools_used'])
  const explicitExecutionTime = getNumber(args, ['executionTime', 'execution_time'], -1)
  const modelCalls = getNumber(args, ['modelCalls', 'model_calls'])
  const runSessionStart = getBoolean(args, ['runSessionStart', 'run_session_start'], true) ?? true
  const runBeforeAgent = getBoolean(args, ['runBeforeAgent', 'run_before_agent'], true) ?? true
  const runToolStages = getBoolean(args, ['runToolStages', 'run_tool_stages'], true) ?? true
  const runAfterAgent = getBoolean(args, ['runAfterAgent', 'run_after_agent'], true) ?? true
  const runPreCompress = getBoolean(args, ['runPreCompress', 'run_precompress'], true) ?? true

  const output: Record<string, unknown> = {
    sessionId,
    timestamp,
    pipeline: 'SessionStart -> BeforeAgent -> (BeforeTool/AfterTool)* -> AfterAgent -> PreCompress'
  }

  appendMcpLog({
    category: 'mcp-tool',
    tool: 'gpai_auto_pipeline',
    phase: 'start',
    sessionId,
    hasPrompt: prompt.trim().length > 0,
    hasResult: getString(args, ['result', 'prompt_response']).trim().length > 0,
    toolExecutionCount: toolExecutions.length,
    runSessionStart,
    runBeforeAgent,
    runToolStages,
    runAfterAgent,
    runPreCompress
  })

  if (runSessionStart) {
    const sessionStart = await runHook('SessionStart', {
      sessionId,
      timestamp
    })
    output.sessionStart = sessionStart
  } else {
    output.sessionStart = {
      skipped: true,
      reason: 'runSessionStart=false'
    }
  }

  if (runBeforeAgent) {
    const beforeAgent = await runHook('BeforeAgent', {
      prompt,
      sessionId,
      conversationHistory
    })
    output.beforeAgent = beforeAgent
  } else {
    output.beforeAgent = {
      skipped: true,
      reason: 'runBeforeAgent=false'
    }
  }

  const toolResults: Array<Record<string, unknown>> = []
  const allowedTools: string[] = []
  let deniedByBlock = 0
  let deniedByAsk = 0
  let totalToolExecutionTime = 0

  if (runToolStages) {
    for (let index = 0; index < toolExecutions.length; index += 1) {
      const item = toolExecutions[index]
      const beforeTool = await runHook('BeforeTool', {
        tool: item.tool,
        args: item.args,
        context: ''
      })
      const beforeToolRecord = asRecord(beforeTool)
      const beforeAction = getString(beforeToolRecord, ['action'], 'allow')
      const explicitAllowed = getBoolean(beforeToolRecord, ['allowed'])
      const allowed = beforeAction === 'allow' || explicitAllowed === true

      const stepResult: Record<string, unknown> = {
        index,
        tool: item.tool,
        beforeTool
      }

      if (!allowed) {
        if (beforeAction === 'block') {
          deniedByBlock += 1
        } else {
          deniedByAsk += 1
        }
        stepResult.afterTool = {
          skipped: true,
          reason: `before-tool-${beforeAction}`
        }
        toolResults.push(stepResult)
        continue
      }

      totalToolExecutionTime += item.executionTime
      allowedTools.push(item.tool)

      const afterTool = await runHook('AfterTool', {
        tool: item.tool,
        args: item.args,
        result: item.result,
        executionTime: item.executionTime
      })
      stepResult.afterTool = afterTool
      toolResults.push(stepResult)
    }
  } else {
    output.toolStages = {
      skipped: true,
      reason: 'runToolStages=false'
    }
  }

  if (runToolStages) {
    output.toolStages = toolResults
  }

  const resultText = getString(args, ['result', 'prompt_response'])

  if (runAfterAgent) {
    if (resultText.trim().length > 0) {
      const normalizedError = normalizeErrorPayload(args.error)
      const success =
        getBoolean(args, ['success'], normalizedError ? false : true) ?? (normalizedError ? false : true)
      const mergedTools = uniqueStrings([...explicitTools, ...allowedTools])
      const totalExecutionTime =
        explicitExecutionTime >= 0 ? explicitExecutionTime : Math.max(0, totalToolExecutionTime)

      const afterAgent = await runHook('AfterAgent', {
        sessionId,
        prompt,
        result: resultText,
        executionTime: totalExecutionTime,
        tools_used: mergedTools,
        model_calls: modelCalls,
        success,
        error: normalizedError
      })
      output.afterAgent = afterAgent
    } else {
      output.afterAgent = {
        skipped: true,
        reason: 'Missing result field. Provide result to execute AfterAgent.'
      }
    }
  } else {
    output.afterAgent = {
      skipped: true,
      reason: 'runAfterAgent=false'
    }
  }

  if (runPreCompress) {
    const forcePreCompress = getBoolean(args, ['forcePreCompress', 'force_precompress'], false) ?? false
    const tokenUsage = getNumber(args, ['tokenUsage', 'token_usage'])
    const maxTokens = getNumber(args, ['maxTokens', 'max_tokens'], 100000)
    const ratio = normalizeRatio(getNumber(args, ['preCompressRatio', 'pre_compress_ratio'], 0.85), 0.85)
    const shouldRunCompress =
      forcePreCompress || (maxTokens > 0 && tokenUsage >= Math.floor(maxTokens * ratio))

    if (shouldRunCompress) {
      const preCompress = await runHook('PreCompress', {
        sessionId,
        tokenUsage,
        maxTokens
      })
      output.preCompress = preCompress
    } else {
      output.preCompress = {
        skipped: true,
        reason: `Token usage below threshold (${tokenUsage}/${maxTokens}, ratio=${ratio}).`
      }
    }
  } else {
    output.preCompress = {
      skipped: true,
      reason: 'runPreCompress=false'
    }
  }

  output.summary = {
    totalToolStages: runToolStages ? toolExecutions.length : 0,
    allowedToolStages: allowedTools.length,
    blockedToolStages: deniedByBlock,
    confirmationRequiredStages: deniedByAsk,
    ranSessionStart: runSessionStart,
    ranBeforeAgent: runBeforeAgent,
    ranToolStages: runToolStages
  }

  appendMcpLog({
    category: 'mcp-tool',
    tool: 'gpai_auto_pipeline',
    phase: 'done',
    sessionId,
    summary: output.summary
  })

  return output
}

function extractToolArguments(params: unknown): Record<string, unknown> {
  const normalized = asRecord(params)
  return asRecord(normalized.arguments || normalized.payload || normalized)
}

function toolCallName(params: unknown): string {
  const normalized = asRecord(params)
  return typeof normalized.name === 'string' ? normalized.name : ''
}

function respondToolOutput(id: JsonRpcId, payload: Record<string, unknown>): void {
  respond(id, {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload)
      }
    ],
    structuredContent: payload
  })
}

function handleToolInvocation(id: JsonRpcId, name: string, args: Record<string, unknown>): void {
  if (name === 'gpai_health') {
    appendMcpLog({
      category: 'mcp-tool',
      tool: 'gpai_health',
      phase: 'done'
    })
    const echo = typeof args.echo === 'string' ? args.echo : ''
    respondToolOutput(id, {
      ok: true,
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      echo
    })
    return
  }

  if (name === 'gpai_run_hook') {
    const event = getHookEvent(args.event)
    if (!event) {
      respondError(
        id,
        -32602,
        'Invalid arguments: event must be one of SessionStart/BeforeAgent/BeforeTool/AfterTool/AfterAgent/PreCompress.'
      )
      return
    }
    appendMcpLog({
      category: 'mcp-tool',
      tool: 'gpai_run_hook',
      phase: 'start',
      event
    })
    const payload = asRecord(args.payload)
    runHook(event, payload)
      .then((result) => {
        appendMcpLog({
          category: 'mcp-tool',
          tool: 'gpai_run_hook',
          phase: 'done',
          event
        })
        respondToolOutput(id, {
          event,
          result
        })
      })
      .catch((error: Error) => {
        appendMcpLog({
          category: 'mcp-tool',
          tool: 'gpai_run_hook',
          phase: 'error',
          event,
          message: error.message || 'Failed to run GPAI hook.'
        })
        respondError(id, -32000, error.message || 'Failed to run GPAI hook.')
      })
    return
  }

  if (name === 'gpai_auto_pipeline') {
    runAutoPipeline(args)
      .then((result) => {
        respondToolOutput(id, result)
      })
      .catch((error: Error) => {
        appendMcpLog({
          category: 'mcp-tool',
          tool: 'gpai_auto_pipeline',
          phase: 'error',
          sessionId: getString(args, ['sessionId', 'session_id'], 'mcp-session'),
          message: error.message || 'Failed to run GPAI auto pipeline.'
        })
        respondError(id, -32000, error.message || 'Failed to run GPAI auto pipeline.')
      })
    return
  }

  respondError(id, -32601, `Unknown tool: ${name}`)
}

function writeMessage(payload: Record<string, unknown>): void {
  if (outputMode === 'raw') {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }

  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')
  process.stdout.write(Buffer.concat([header, body]))
}

function respond(id: JsonRpcId, result: Record<string, unknown>): void {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    result
  }
  writeMessage(response as unknown as Record<string, unknown>)
}

function respondError(id: JsonRpcId, code: number, message: string): void {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message
    }
  }
  writeMessage(response as unknown as Record<string, unknown>)
}

function findFrameSeparator(buffer: Buffer): { index: number; length: number } | null {
  const crlfIndex = buffer.indexOf('\r\n\r\n')
  const lfIndex = buffer.indexOf('\n\n')

  if (crlfIndex < 0 && lfIndex < 0) {
    return null
  }

  if (crlfIndex >= 0 && lfIndex >= 0) {
    if (crlfIndex <= lfIndex) {
      return { index: crlfIndex, length: 4 }
    }
    return { index: lfIndex, length: 2 }
  }

  if (crlfIndex >= 0) {
    return { index: crlfIndex, length: 4 }
  }

  return { index: lfIndex, length: 2 }
}

function parseJsonRequest(text: string): JsonRpcRequest | null {
  try {
    const parsed = JSON.parse(text) as JsonRpcRequest
    if (!parsed || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function tryHandleRawJsonBuffer(): boolean {
  const raw = readBuffer.toString('utf8').trim()
  if (!raw) {
    return false
  }

  const parsed = parseJsonRequest(raw)
  if (!parsed) {
    return false
  }

  outputMode = 'raw'
  readBuffer = Buffer.alloc(0)
  handleRequest(parsed)
  return true
}

function tryHandleRawJsonLines(): boolean {
  const rawText = readBuffer.toString('utf8')
  if (!rawText.includes('\n')) {
    return false
  }

  const endsWithNewline = /\r?\n$/.test(rawText)
  const splitLines = rawText.split(/\r?\n/)
  const lastFragment = endsWithNewline ? '' : splitLines.pop() || ''

  const parsedMessages: JsonRpcRequest[] = []
  splitLines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    const parsed = parseJsonRequest(trimmed)
    if (parsed) {
      parsedMessages.push(parsed)
    }
  })

  if (parsedMessages.length === 0) {
    return false
  }

  outputMode = 'raw'
  parsedMessages.forEach((message) => handleRequest(message))
  readBuffer = Buffer.from(lastFragment, 'utf8')
  return true
}

function handleRequest(message: JsonRpcRequest): void {
  const id: JsonRpcId = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id || null : null
  const method = message.method

  if (method === 'initialize') {
    initialized = true
    respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: false
        },
        resources: {},
        prompts: {}
      },
      serverInfo: SERVER_INFO
    })
    return
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return
  }

  if (method === 'ping') {
    respond(id, {})
    return
  }

  if (!initialized) {
    respondError(id, -32002, 'Server not initialized')
    return
  }

  if (method === 'tools/list') {
    respond(id, { tools: EXPOSED_TOOLS })
    return
  }

  if (method === 'list_tools') {
    respond(id, { tools: EXPOSED_TOOLS })
    return
  }

  if (method === 'resources/list') {
    respond(id, { resources: [] })
    return
  }

  if (method === 'prompts/list') {
    respond(id, { prompts: [] })
    return
  }

  if (method === 'tools/call') {
    const toolName = toolCallName(message.params)
    const args = extractToolArguments(message.params)
    handleToolInvocation(id, toolName, args)
    return
  }

  if (method === 'call_tool') {
    const toolName = toolCallName(message.params)
    const args = extractToolArguments(message.params)
    handleToolInvocation(id, toolName, args)
    return
  }

  respondError(id, -32601, `Method not found: ${method}`)
}

function parseAndHandleIncoming(): void {
  while (readBuffer.length > 0) {
    const separator = findFrameSeparator(readBuffer)
    if (!separator) {
      // Fallback for clients that write plain JSON without MCP framing.
      if (tryHandleRawJsonLines()) {
        continue
      }
      tryHandleRawJsonBuffer()
      return
    }

    const headerPart = readBuffer.slice(0, separator.index).toString('utf8')
    const contentLengthMatch = headerPart.match(/content-length:\s*(\d+)/i)
    if (!contentLengthMatch) {
      // If framing header isn't present, fallback to plain JSON mode.
      if (tryHandleRawJsonBuffer()) {
        continue
      }

      // Invalid frame, drop buffer to avoid infinite loop.
      readBuffer = Buffer.alloc(0)
      return
    }

    const contentLength = Number(contentLengthMatch[1])
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      readBuffer = Buffer.alloc(0)
      return
    }

    const frameSize = separator.index + separator.length + contentLength
    if (readBuffer.length < frameSize) {
      return
    }

    const bodyBuffer = readBuffer.slice(separator.index + separator.length, frameSize)
    readBuffer = readBuffer.slice(frameSize)

    const parsed = parseJsonRequest(bodyBuffer.toString('utf8'))
    if (!parsed) {
      continue
    }
    outputMode = 'framed'
    handleRequest(parsed)
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  readBuffer = Buffer.concat([readBuffer, chunk])
  parseAndHandleIncoming()
})

process.stdin.on('error', () => {
  process.exit(1)
})

process.stdin.resume()
