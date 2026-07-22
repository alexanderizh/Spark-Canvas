import type { ManagedAgent, SessionCreateRequest } from '@spark/protocol'
import { CANVAS_ASSISTANT_AGENT_ID } from '@spark/shared'

export const DEFAULT_CANVAS_AGENT_ID = CANVAS_ASSISTANT_AGENT_ID

export const CANVAS_AGENT_SKILL_IDS = [
  'builtin:canvas-studio',
  'builtin:multimedia-use',
  'builtin:video-workflow',
] as const
export type CanvasAgentSkillId = (typeof CANVAS_AGENT_SKILL_IDS)[number]

const CANVAS_AGENT_SKILL_ID_SET = new Set<string>(CANVAS_AGENT_SKILL_IDS)

export const CANVAS_AGENT_PREFS_KEY = 'spark-canvas:canvas-agent-composer-prefs'
export const LEGACY_CANVAS_AGENT_PREFS_KEY = 'spark-agent:canvas-agent-composer-prefs'
export const CANVAS_AGENT_DRAFTS_KEY = 'spark-canvas:canvas-agent-input-drafts'
export const LEGACY_CANVAS_AGENT_DRAFTS_KEY = 'spark-agent:canvas-agent-input-drafts'

export function createCanvasSessionRequest(
  request: Omit<SessionCreateRequest, 'surface'>,
): SessionCreateRequest {
  return { ...request, surface: 'canvas' }
}

export function filterCanvasAssistantAgents(agents: ManagedAgent[]): ManagedAgent[] {
  const builtInCanvasAssistant = agents.find(
    (agent) => agent.builtIn && agent.id === DEFAULT_CANVAS_AGENT_ID,
  )
  return builtInCanvasAssistant == null ? [] : [builtInCanvasAssistant]
}

export function pickCanvasAssistantAgent(
  agents: ManagedAgent[],
  preferredId: string | null | undefined,
): ManagedAgent | null {
  const candidates = filterCanvasAssistantAgents(agents)
  return (
    (preferredId != null ? candidates.find((agent) => agent.id === preferredId) : undefined) ??
    candidates.find((agent) => agent.id === DEFAULT_CANVAS_AGENT_ID) ??
    candidates[0] ??
    null
  )
}

export function isCanvasAgentSkillId(skillId: string): skillId is CanvasAgentSkillId {
  return CANVAS_AGENT_SKILL_ID_SET.has(skillId)
}

export function filterCanvasAgentSkills<T extends { id: string }>(skills: T[]): T[] {
  return skills.filter((skill) => isCanvasAgentSkillId(skill.id))
}

interface CanvasAgentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function readCanvasAgentStorageItem(
  storage: CanvasAgentStorage,
  key: string,
  legacyKey: string,
): string | null {
  const current = storage.getItem(key)
  if (current != null) return current

  const legacy = storage.getItem(legacyKey)
  if (legacy == null) return null
  try {
    storage.setItem(key, legacy)
    storage.removeItem(legacyKey)
  } catch {
    // Reading old preferences must not block the Canvas Agent UI.
  }
  return legacy
}
