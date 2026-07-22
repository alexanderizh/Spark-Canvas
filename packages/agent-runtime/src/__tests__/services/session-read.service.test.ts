import { describe, expect, it, vi } from 'vitest'
import type { AgentEventRow, SessionRow, SparkDatabase } from '@spark/storage'
import {
  SessionReadService,
  type SessionReadRepositories,
} from '../../services/session-read.service.js'

const sessionRow: SessionRow = {
  id: 'session-1',
  kind: 'canvas',
  title: 'Storyboard session',
  status: 'idle',
  project_id: 'project-1',
  workspace_ids_json: JSON.stringify(['workspace-1']),
  rule_bundle_id: null,
  permission_profile_id: null,
  provider_profile_id: 'provider-1',
  model_id: 'model-1',
  agent_adapter: 'claude-sdk',
  agent_id: 'canvas-assistant-agent',
  permission_mode: 'claude-ask',
  chat_mode: 'agent',
  reasoning_effort: 'high',
  pinned_at: null,
  archived_at: null,
  turn_count: 2,
  logical_message_count: 4,
  metadata_json: '{}',
  created_at: '2026-07-20T00:00:00.000Z',
  updated_at: '2026-07-20T00:00:00.000Z',
}

function createService(
  events: AgentEventRow[] = [],
  list: SessionReadRepositories['sessionRepository']['list'] = () => ({
    sessions: [sessionRow],
    total: 1,
  }),
): SessionReadService {
  const repositories: SessionReadRepositories = {
    sessionRepository: {
      list,
      getWorkspaceIdsFromRow: (row) => JSON.parse(row.workspace_ids_json) as string[],
    },
    eventRepository: {
      queryAllBySession: () => events,
      queryRenderablePage: () => ({ events, hasMore: false }),
      queryRenderableTurns: () => ({ events, hasMore: false }),
    },
  }
  return new SessionReadService({} as SparkDatabase, repositories)
}

describe('SessionReadService', () => {
  it('maps persisted sessions without constructing the agent runtime', async () => {
    const result = await createService().listSessions({
      workspaceId: 'workspace-1',
    })

    expect(result.total).toBe(1)
    expect(result.sessions[0]).toMatchObject({
      id: 'session-1',
      projectId: 'project-1',
      workspaceIds: ['workspace-1'],
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-ask',
      reasoningEffort: 'high',
    })
  })

  it('forwards the canvas surface filter and includes the parsed surface in summaries', async () => {
    const list = vi.fn(() => ({
      sessions: [
        {
          ...sessionRow,
          metadata_json: JSON.stringify({ surface: 'canvas' }),
        },
      ],
      total: 1,
    }))

    const result = await createService([], list).listSessions({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      surface: 'canvas',
      agentId: 'canvas-assistant-agent',
      limit: 10,
      offset: 0,
    })

    expect(list).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      surface: 'canvas',
      agentId: 'canvas-assistant-agent',
      limit: 10,
      offset: 0,
    })
    expect(result.sessions[0]?.surface).toBe('canvas')
  })

  it('uses Canvas Assistant for a session row with a missing agent id', async () => {
    const result = await createService([], () => ({
      sessions: [{ ...sessionRow, agent_id: null } as unknown as SessionRow],
      total: 1,
    })).listSessions()

    expect(result.sessions[0]?.agentId).toBe('canvas-assistant-agent')
  })

  it('preserves an explicit platform manager agent id', async () => {
    const result = await createService([], () => ({
      sessions: [{ ...sessionRow, agent_id: 'platform-manager-agent' }],
      total: 1,
    })).listSessions()

    expect(result.sessions[0]?.agentId).toBe('platform-manager-agent')
  })

  it('returns renderable history and trims oversized prompt snapshots', async () => {
    const eventRow: AgentEventRow = {
      id: 'event-1',
      session_id: 'session-1',
      run_id: null,
      turn_id: 'turn-1',
      event_type: 'turn_prompt_snapshot',
      event_json: JSON.stringify({
        id: 'event-1',
        type: 'turn_prompt_snapshot',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-07-20T00:00:00.000Z',
        seq: 1,
        systemPromptSections: [{ label: 'project', content: 'x'.repeat(1200), charCount: 1200 }],
      }),
      created_at: '2026-07-20T00:00:00.000Z',
      seq: 1,
      event_mode: null,
    }

    const result = await createService([eventRow]).getHistory({
      sessionId: 'session-1',
      full: true,
    })
    const historyEvent = result.events[0]

    expect(result.hasMore).toBe(false)
    expect(historyEvent?.type).toBe('turn_prompt_snapshot')
    if (historyEvent?.type !== 'turn_prompt_snapshot') throw new Error('Unexpected event type')
    expect(historyEvent.systemPromptSections[0]?.content).toHaveLength(800)
  })
})
