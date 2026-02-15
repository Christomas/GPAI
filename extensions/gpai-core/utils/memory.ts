import * as fs from 'fs'
import * as path from 'path'

export type MemoryTier = 'hot' | 'warm' | 'cold'

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

export function readJsonl(filePath: string): any[] {
  if (!fs.existsSync(filePath)) {
    return []
  }

  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((entry) => entry !== null)
}

export function appendJsonl(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n')
}

export function loadMemory(gpaiDir: string, tier: MemoryTier, limit: number): any[] {
  const filePath = path.join(gpaiDir, `data/memory/${tier}.jsonl`)
  return readJsonl(filePath).slice(-limit)
}

export function saveToMemory(gpaiDir: string, tier: MemoryTier, entry: unknown): void {
  const filePath = path.join(gpaiDir, `data/memory/${tier}.jsonl`)
  appendJsonl(filePath, entry)
}
