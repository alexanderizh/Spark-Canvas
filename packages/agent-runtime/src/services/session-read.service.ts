import { EventRepository, SessionRepository, type SparkDatabase } from '@spark/storage'
import { CANVAS_ASSISTANT_AGENT_ID } from '@spark/shared/constants'
import type {
  AgentEvent,
  HistoryImportSource,
  SessionId,
  SessionListResponse,
  SessionPermissionMode,
  SessionSurface,
} from '@spark/protocol'
import { normalizeSparkReasoningEffort } from '../sdk/reasoning-effort.js'
import { getSessionSurface } from './session-surface.js'

export type AgentAdapterKind = 'claude' | 'claude-sdk' | 'codex'

export interface SessionHistoryParams {
  sessionId: string
  full?: boolean
  limit?: number
  turnLimit?: number
  eventLimit?: number
  beforeSeq?: number
}

export interface SessionReadRepositories {
  eventRepository: Pick<
    EventRepository,
    'queryAllBySession' | 'queryRenderablePage' | 'queryRenderableTurns'
  >
  sessionRepository: Pick<SessionRepository, 'getWorkspaceIdsFromRow' | 'list'>
}

export function getAgentAdapterFromSession(
  value: string | null | undefined,
  legacyChatMode: string | null | undefined,
  providerType: string | null,
): AgentAdapterKind {
  if (value === 'claude-sdk' || value === 'codex') return value
  if (value === 'claude') return 'claude-sdk'
  if (legacyChatMode === 'claude-sdk' || legacyChatMode === 'codex') return legacyChatMode
  if (legacyChatMode === 'claude') return 'claude-sdk'
  return providerType === 'anthropic' ? 'claude-sdk' : 'codex'
}

export function getPermissionModeFromSession(
  value: string | null | undefined,
  adapter: AgentAdapterKind,
): SessionPermissionMode {
  if (
    value === 'claude-ask' ||
    value === 'claude-auto-edits' ||
    value === 'claude-plan' ||
    value === 'claude-auto' ||
    value === 'claude-bypass' ||
    value === 'codex-default' ||
    value === 'codex-auto-review' ||
    value === 'codex-full-access'
  ) {
    return value
  }
  return adapter === 'codex' ? 'codex-default' : 'claude-ask'
}

function getChatModeFromSession(
  value: string | null | undefined,
): 'agent' | 'ask' | 'edit' | 'review' {
  if (value === 'ask' || value === 'edit' || value === 'review') return value
  return 'agent'
}

function getImportedFromMetadata(
  metadataJson: string | null | undefined,
): HistoryImportSource | null {
  if (metadataJson == null || metadataJson === '') return null
  try {
    const meta = JSON.parse(metadataJson) as { importedFrom?: unknown }
    if (meta.importedFrom === 'claude-code' || meta.importedFrom === 'codex') {
      return meta.importedFrom
    }
  } catch {
    return null
  }
  return null
}

export function getDebugModeFromMetadata(metadataJson: string | null | undefined): boolean {
  if (metadataJson == null || metadataJson === '') return false
  try {
    const meta = JSON.parse(metadataJson) as { debugMode?: unknown }
    return meta.debugMode === true
  } catch {
    return false
  }
}

const HISTORY_PROMPT_SECTION_CHAR_CAP = 800

function trimHistoryEvent(event: AgentEvent): AgentEvent {
  if (event.type !== 'turn_prompt_snapshot') return event
  const sections = event.systemPromptSections
  if (!Array.isArray(sections) || sections.length === 0) return event
  let trimmedAny = false
  const trimmedSections = sections.map((section) => {
    if (
      typeof section.content === 'string' &&
      section.content.length > HISTORY_PROMPT_SECTION_CHAR_CAP
    ) {
      trimmedAny = true
      return { ...section, content: section.content.slice(0, HISTORY_PROMPT_SECTION_CHAR_CAP) }
    }
    return section
  })
  return trimmedAny ? { ...event, systemPromptSections: trimmedSections } : event
}

export class SessionReadService {
  private readonly repositories: SessionReadRepositories

  constructor(db: SparkDatabase, repositories?: SessionReadRepositories) {
    this.repositories =
      repositories ??
      ({
        eventRepository: new EventRepository(db),
        sessionRepository: new SessionRepository(db),
      } satisfies SessionReadRepositories)
  }

  async getHistory(params: SessionHistoryParams): Promise<{
    events: AgentEvent[]
    hasMore: boolean
  }> {
    const eventRepo = this.repositories.eventRepository
    if (params.full === true) {
      const rows = eventRepo.queryAllBySession(params.sessionId)
      return {
        events: rows.map((row) => trimHistoryEvent(JSON.parse(row.event_json) as AgentEvent)),
        hasMore: false,
      }
    }
    if (params.turnLimit != null) {
      const { events: rows, hasMore } = eventRepo.queryRenderableTurns({
        sessionId: params.sessionId,
        turnLimit: params.turnLimit,
        ...(params.eventLimit != null ? { eventLimit: params.eventLimit } : {}),
        ...(params.beforeSeq != null ? { beforeSeq: params.beforeSeq } : {}),
      })
      return {
        events: rows.map((row) => trimHistoryEvent(JSON.parse(row.event_json) as AgentEvent)),
        hasMore,
      }
    }
    const { events: rows, hasMore } = eventRepo.queryRenderablePage({
      sessionId: params.sessionId,
      limit: params.limit ?? 80,
      ...(params.beforeSeq != null ? { beforeSeq: params.beforeSeq } : {}),
    })
    return {
      events: rows.map((row) => trimHistoryEvent(JSON.parse(row.event_json) as AgentEvent)),
      hasMore,
    }
  }

  async listSessions(params?: {
    projectId?: string
    workspaceId?: string
    surface?: SessionSurface
    agentId?: string
    limit?: number
    offset?: number
    includeArchived?: boolean
  }): Promise<SessionListResponse> {
    const sessionRepo = this.repositories.sessionRepository
    const { sessions: rows, total } = sessionRepo.list(params ?? {})
    const sessions = rows.map((row) => {
      const agentAdapter = getAgentAdapterFromSession(row.agent_adapter, row.chat_mode, null)
      const importedFrom = getImportedFromMetadata(row.metadata_json)
      const surface = getSessionSurface(row.metadata_json)
      return {
        id: row.id as SessionId,
        title: row.title,
        projectId: row.project_id,
        workspaceIds: sessionRepo.getWorkspaceIdsFromRow(row),
        providerProfileId: row.provider_profile_id ?? '',
        modelId: row.model_id,
        agentId: row.agent_id ?? CANVAS_ASSISTANT_AGENT_ID,
        agentAdapter,
        permissionMode: getPermissionModeFromSession(row.permission_mode, agentAdapter),
        chatMode: getChatModeFromSession(row.chat_mode),
        reasoningEffort: normalizeSparkReasoningEffort(row.reasoning_effort),
        status: row.status as 'idle' | 'running' | 'error',
        pinnedAt: row.pinned_at,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        turnCount: row.turn_count,
        logicalMessageCount: row.logical_message_count,
        messageCount: row.logical_message_count,
        ...(importedFrom != null ? { importedFrom } : {}),
        debugMode: getDebugModeFromMetadata(row.metadata_json),
        ...(surface != null ? { surface } : {}),
      }
    })
    return { sessions, total }
  }
}
