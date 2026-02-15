import { Agent, AgentSelectionInput } from './types'

export function selectAgents(input: AgentSelectionInput): Agent[] {
  const ids = input.mapping[input.intent] || input.mapping.analysis || []
  const selected = ids
    .map((id) => input.available.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent))

  if (selected.length > 0) {
    return selected
  }

  return input.available.slice(0, 2)
}
