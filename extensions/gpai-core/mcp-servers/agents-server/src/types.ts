export interface Agent {
  id: string
  name: string
  role: string
  personality: string
  systemPrompt: string
  expertise: string[]
}

export interface AgentSelectionInput {
  intent: string
  available: Agent[]
  mapping: Record<string, string[]>
}
