export interface MemoryEntry {
  id: string
  type: 'hot' | 'warm' | 'cold'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface SearchQuery {
  keyword: string
  limit?: number
  tiers?: Array<'hot' | 'warm' | 'cold'>
}
