import * as path from 'path'
import { saveToMemory } from '../utils/memory'

interface AfterToolInput {
  tool: string
  result: unknown
  executionTime: number
  args: Record<string, unknown>
}

interface AfterToolOutput {
  capturedResult: unknown
  saveToMemory: boolean
  metadata: Record<string, unknown>
}

function resolveGpaiDir(): string {
  return process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
}

export async function handleAfterTool(input: AfterToolInput): Promise<AfterToolOutput> {
  const gpaiDir = resolveGpaiDir()

  try {
    const capturedResult = {
      tool: input.tool,
      result: input.result,
      duration: input.executionTime,
      timestamp: new Date().toISOString()
    }

    const resultSize = JSON.stringify(input.result ?? '').length
    const memoryEntry = {
      type: 'tool_execution',
      content: `Executed ${input.tool} in ${input.executionTime}ms`,
      timestamp: Date.now(),
      metadata: {
        tool: input.tool,
        duration: input.executionTime,
        resultSize,
        success: true
      }
    }

    saveToMemory(gpaiDir, 'hot', memoryEntry)

    return {
      capturedResult,
      saveToMemory: true,
      metadata: {
        toolExecution: {
          tool: input.tool,
          success: true,
          duration: input.executionTime
        }
      }
    }
  } catch (error) {
    return {
      capturedResult: input.result,
      saveToMemory: false,
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}

if (require.main === module) {
  const input = JSON.parse(process.argv[2] || '{}') as AfterToolInput
  handleAfterTool(input)
    .then((output) => {
      process.stdout.write(JSON.stringify(output))
      process.exit(0)
    })
    .catch((error: Error) => {
      process.stderr.write(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}

export default handleAfterTool
