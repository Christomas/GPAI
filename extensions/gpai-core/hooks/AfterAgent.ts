import * as path from 'path'
import { saveToMemory } from '../utils/memory'

interface AfterAgentInput {
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

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

export async function handleAfterAgent(input: AfterAgentInput): Promise<AfterAgentOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const implicitSignals = {
      type: 'implicit_signal',
      content: `Task completed: ${input.tools_used.length} tools, ${input.model_calls} model calls, ${input.executionTime}ms`,
      timestamp: Date.now(),
      metadata: {
        executionTime: input.executionTime,
        toolsUsed: input.tools_used,
        modelCalls: input.model_calls,
        success: input.success
      }
    }

    if (input.success) {
      saveToMemory(gpaiDir, 'hot', implicitSignals)
      return {
        askForRating: true,
        learningCaptured: false,
        message: 'Task completed! Please rate your experience (1-10 score) to help me improve.'
      }
    }

    if (input.error) {
      const errorEntry = {
        type: 'error',
        content: input.error.message,
        timestamp: Date.now(),
        metadata: {
          tools_used: input.tools_used,
          model_calls: input.model_calls,
          error: input.error.message
        }
      }

      saveToMemory(gpaiDir, 'warm', errorEntry)

      return {
        askForRating: false,
        learningCaptured: true,
        message: `Task failed: ${input.error.message}`
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
