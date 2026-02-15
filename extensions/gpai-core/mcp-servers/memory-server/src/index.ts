import * as path from 'path'
import { MemoryStore } from './memory'
import { MemoryEntry } from './types'

interface Command {
  action: 'add' | 'list' | 'search'
  payload?: any
}

const gpaiDir = process.env.GPAI_DIR || path.join(process.env.HOME || process.cwd(), '.gpai')
const store = new MemoryStore(path.join(gpaiDir, 'data/memory'))

async function run(command: Command): Promise<unknown> {
  switch (command.action) {
    case 'add': {
      const payload = command.payload as Partial<MemoryEntry>
      if (!payload.type || !payload.content) {
        throw new Error('Missing type or content')
      }

      store.add({
        id: payload.id || `${Date.now()}`,
        type: payload.type,
        content: payload.content,
        timestamp: payload.timestamp || Date.now(),
        metadata: payload.metadata || {}
      })
      return { ok: true }
    }
    case 'list': {
      const payload = command.payload || {}
      return store.list(payload.type || 'hot', payload.limit || 20)
    }
    case 'search': {
      const payload = command.payload || {}
      return store.search({
        keyword: payload.keyword || '',
        limit: payload.limit || 20,
        tiers: payload.tiers || ['hot', 'warm', 'cold']
      })
    }
    default:
      throw new Error(`Unsupported action: ${command.action}`)
  }
}

if (require.main === module) {
  const input = process.argv[2]
  if (!input) {
    process.stderr.write('Usage: node index.js "{\\"action\\":\\"list\\"}"\n')
    process.exit(1)
  }

  const command = JSON.parse(input) as Command
  run(command)
    .then((result) => {
      process.stdout.write(JSON.stringify(result))
      process.exit(0)
    })
    .catch((error: Error) => {
      process.stderr.write(JSON.stringify({ error: error.message }))
      process.exit(1)
    })
}
