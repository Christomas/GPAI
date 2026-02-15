import * as fs from 'fs'
import * as path from 'path'
import { MemoryEntry, SearchQuery } from './types'

export class MemoryStore {
  private readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
    fs.mkdirSync(this.baseDir, { recursive: true })
  }

  private getFilePath(tier: MemoryEntry['type']): string {
    return path.join(this.baseDir, `${tier}.jsonl`)
  }

  add(entry: MemoryEntry): void {
    const filePath = this.getFilePath(entry.type)
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n')
  }

  list(tier: MemoryEntry['type'], limit = 20): MemoryEntry[] {
    const filePath = this.getFilePath(tier)

    if (!fs.existsSync(filePath)) {
      return []
    }

    return fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as MemoryEntry)
      .slice(-limit)
  }

  search(query: SearchQuery): MemoryEntry[] {
    const tiers = query.tiers || ['hot', 'warm', 'cold']
    const limit = query.limit ?? 20
    const keyword = query.keyword.toLowerCase()

    const hits = tiers.flatMap((tier) =>
      this.list(tier, 200).filter((entry) => entry.content.toLowerCase().includes(keyword))
    )

    return hits.slice(0, limit)
  }
}
