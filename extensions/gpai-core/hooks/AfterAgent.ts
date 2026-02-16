import * as path from 'path'
import { loadConfig, resolveOutputContract, type OutputContractConfig } from '../utils/config'
import { saveMemoryEntry } from '../utils/memory'
import { inferTaskComplexity, maybeRecomputeSuccessPatterns, updateSuccessPattern } from '../utils/profile'
import { appendTelosLearning } from '../utils/telos'
import { appendHistoryEntry, finalizeLatestWorkItem } from '../utils/work'

interface AfterAgentInput {
  sessionId?: string
  prompt?: string
  result: string
  executionTime: number
  tools_used: string[]
  model_calls: number
  success: boolean
  error?: {
    message: string
  }
}

interface AfterAgentOutput {
  askForRating: boolean
  learningCaptured: boolean
  message?: string
}

interface OutputContractValidation {
  ok: boolean
  reason?: string
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

function getOutputContractConfig(): OutputContractConfig {
  try {
    const config = loadConfig()
    return resolveOutputContract(config.prompts)
  } catch {
    return {
      language: 'chinese',
      firstVisibleChar: '🗣️'
    }
  }
}

function validateLanguageSignal(input: string, language: OutputContractConfig['language']): boolean {
  if (language === 'any') {
    return true
  }
  if (language === 'english') {
    return /[A-Za-z]/.test(input)
  }
  // relaxed chinese check: allow English proper nouns mixed in response.
  return /[\u4e00-\u9fff]/.test(input)
}

function validateOutputContract(
  result: string,
  contractConfig: OutputContractConfig
): OutputContractValidation {
  const normalized = String(result || '').trimStart()
  const requiredPrefix = contractConfig.firstVisibleChar

  if (!normalized.startsWith(requiredPrefix)) {
    return {
      ok: false,
      reason: `Output contract violation: first visible character must be ${requiredPrefix}`
    }
  }

  const payload = normalized.slice(requiredPrefix.length).trim()
  if (!validateLanguageSignal(payload, contractConfig.language)) {
    const languageLabel =
      contractConfig.language === 'any'
        ? 'any'
        : contractConfig.language === 'english'
          ? 'English'
          : 'Chinese'
    return {
      ok: false,
      reason: `Output contract violation: response must include ${languageLabel} content.`
    }
  }

  return {
    ok: true
  }
}

export async function handleAfterAgent(input: AfterAgentInput): Promise<AfterAgentOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const outputContract = getOutputContractConfig()
    const contractValidation = input.success
      ? validateOutputContract(input.result, outputContract)
      : ({ ok: true } as OutputContractValidation)
    const contractError = contractValidation.ok ? undefined : contractValidation.reason
    const effectiveSuccess = input.success && !contractError
    const completionStatus = effectiveSuccess ? 'completed' : 'failed'
    const errorMessage = input.error?.message || contractError
    const taskComplexity = inferTaskComplexity({
      prompt: input.prompt,
      result: input.result,
      toolsUsed: input.tools_used,
      executionTime: input.executionTime,
      modelCalls: input.model_calls
    })

    const updatedWorkItem = finalizeLatestWorkItem(gpaiDir, {
      sessionId: input.sessionId,
      success: effectiveSuccess,
      executionTime: input.executionTime,
      toolsUsed: input.tools_used,
      modelCalls: input.model_calls,
      errorMessage,
      resultSummary: input.result
    })

    appendHistoryEntry(gpaiDir, {
      sessionId: input.sessionId || updatedWorkItem?.sessionId || 'unknown-session',
      intent: updatedWorkItem?.intent || 'analysis',
      project: updatedWorkItem?.project,
      complexity: updatedWorkItem?.complexity || taskComplexity,
      agents: updatedWorkItem?.agents || [],
      result: input.result.replace(/\s+/g, ' ').trim().slice(0, 300),
      status: completionStatus,
      timestamp: new Date().toISOString(),
      workItemId: updatedWorkItem?.id,
      toolsUsed: input.tools_used,
      modelCalls: input.model_calls,
      executionTime: input.executionTime
    })

    if (updatedWorkItem?.agents?.length && updatedWorkItem.intent) {
      updateSuccessPattern(gpaiDir, {
        task: updatedWorkItem.intent,
        agents: updatedWorkItem.agents,
        success: effectiveSuccess,
        toolsUsed: input.tools_used,
        project: updatedWorkItem.project,
        complexity: updatedWorkItem.complexity || taskComplexity,
        prompt: input.prompt,
        result: input.result,
        executionTime: input.executionTime,
        modelCalls: input.model_calls,
        intent: updatedWorkItem.intent
      })
    }

    const recomputeResult = maybeRecomputeSuccessPatterns(gpaiDir)
    if (recomputeResult.triggered) {
      saveMemoryEntry(gpaiDir, 'warm', {
        type: 'learning_event',
        sessionId: input.sessionId || updatedWorkItem?.sessionId,
        intent: updatedWorkItem?.intent || 'analysis',
        agents: updatedWorkItem?.agents || [],
        content: `Success pattern recompute triggered (${recomputeResult.reason})`,
        tags: ['learning', 'success-pattern', 'recompute'],
        source: 'after-agent',
        metadata: {
          ...recomputeResult
        }
      })
    }

    const taskTags = ['task-result', completionStatus]
    if (updatedWorkItem?.intent) {
      taskTags.push(updatedWorkItem.intent)
    }
    if (updatedWorkItem?.project) {
      taskTags.push(`project:${updatedWorkItem.project}`)
    }
    taskTags.push(`complexity:${updatedWorkItem?.complexity || taskComplexity}`)
    saveMemoryEntry(gpaiDir, 'warm', {
      type: 'task_result',
      sessionId: input.sessionId || updatedWorkItem?.sessionId,
      intent: updatedWorkItem?.intent || 'analysis',
      agents: updatedWorkItem?.agents || [],
      content: input.result.replace(/\s+/g, ' ').trim().slice(0, 400),
      tags: taskTags,
      source: 'after-agent',
      metadata: {
        executionTime: input.executionTime,
        toolsUsed: input.tools_used,
        modelCalls: input.model_calls,
        success: effectiveSuccess,
        prompt: input.prompt,
        complexity: updatedWorkItem?.complexity || taskComplexity,
        workItemId: updatedWorkItem?.id,
          outputContract: {
          requiredPrefix: outputContract.firstVisibleChar,
          requiredLanguage: outputContract.language,
          validated: contractValidation.ok,
          reason: contractError
        }
      }
    })

    if (effectiveSuccess) {
      const learningSummary = input.result.replace(/\s+/g, ' ').trim().slice(0, 180)
      const learningPrefix = updatedWorkItem?.project
        ? `[${updatedWorkItem.project}]`
        : `[${updatedWorkItem?.intent || 'analysis'}]`
      appendTelosLearning(gpaiDir, `${learningPrefix} ${learningSummary}`)

      saveMemoryEntry(gpaiDir, 'hot', {
        type: 'implicit_signal',
        sessionId: input.sessionId || updatedWorkItem?.sessionId,
        intent: updatedWorkItem?.intent || 'analysis',
        agents: updatedWorkItem?.agents || [],
        content: `Task completed: ${input.tools_used.length} tools, ${input.model_calls} model calls, ${input.executionTime}ms`,
        tags: ['task', 'implicit-signal'],
        source: 'after-agent',
        metadata: {
          executionTime: input.executionTime,
          toolsUsed: input.tools_used,
          modelCalls: input.model_calls,
          success: true,
          complexity: updatedWorkItem?.complexity || taskComplexity,
          workItemId: updatedWorkItem?.id,
          outputContract: {
            requiredPrefix: outputContract.firstVisibleChar,
            requiredLanguage: outputContract.language,
            validated: true
          }
        }
      })
      return {
        askForRating: true,
        learningCaptured: false,
        message: 'Task completed! Please rate your experience (1-10 score) to help me improve.'
      }
    }

    if (errorMessage) {
      saveMemoryEntry(gpaiDir, 'warm', {
        type: 'error',
        sessionId: input.sessionId || updatedWorkItem?.sessionId,
        intent: updatedWorkItem?.intent || 'analysis',
        agents: updatedWorkItem?.agents || [],
        content: errorMessage,
        tags: ['error', 'task-failure'],
        source: 'after-agent',
        metadata: {
          toolsUsed: input.tools_used,
          modelCalls: input.model_calls,
          error: errorMessage,
          complexity: updatedWorkItem?.complexity || taskComplexity,
          workItemId: updatedWorkItem?.id,
          outputContract: {
            requiredPrefix: outputContract.firstVisibleChar,
            requiredLanguage: outputContract.language,
            validated: false,
            reason: contractError
          }
        }
      })

      return {
        askForRating: false,
        learningCaptured: true,
        message: `Task failed: ${errorMessage}`
      }
    }

    return {
      askForRating: false,
      learningCaptured: true
    }
  } catch {
    return {
      askForRating: false,
      learningCaptured: false
    }
  }
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}') as AfterAgentInput
  handleAfterAgent(input)
    .then((output) => {
      process.stdout.write(JSON.stringify(output))
      process.exit(0)
    })
    .catch((error: Error) => {
      process.stderr.write(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleAfterAgent
