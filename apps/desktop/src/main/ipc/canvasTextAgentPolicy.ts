import type { AgentItem } from '@spark/storage'
import { CANVAS_ASSISTANT_AGENT_ID } from '@spark/shared'

interface CanvasTextAgentRepository {
  get(id: string): AgentItem | null
}

export function resolveCanvasTextTaskAgent(
  repository: CanvasTextAgentRepository,
  requestedAgentId: string | null | undefined,
): AgentItem {
  if (requestedAgentId != null && requestedAgentId !== CANVAS_ASSISTANT_AGENT_ID) {
    throw new Error('Canvas text tasks only support the built-in Canvas Assistant')
  }

  const assistant = repository.get(CANVAS_ASSISTANT_AGENT_ID)
  if (assistant == null || !assistant.builtIn || !assistant.enabled) {
    throw new Error('Built-in Canvas Assistant is unavailable')
  }
  return assistant
}
