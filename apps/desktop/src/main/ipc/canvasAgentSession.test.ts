import { describe, expect, it, vi } from 'vitest'

import { CANVAS_ASSISTANT_AGENT_ID } from '@spark/shared'
import {
  CanvasAgentSessionFacade,
  toCanvasAgentSessionRecord,
  type CanvasAgentSessionDependencies,
} from './canvasAgentSession.js'

const sender = { id: 'canvas-window' }
const context = {
  projectId: 'project-1',
  projectTitle: 'Film Project',
  workspaceId: '00000000-0000-4000-8000-000000000010',
}
const sessionId = '00000000-0000-4000-8000-000000000020'

const assistant = {
  id: CANVAS_ASSISTANT_AGENT_ID,
  name: '画布助手',
  description: '',
  builtIn: true,
  enabled: true,
  isDefault: true,
  agentAdapter: 'claude-sdk',
  permissionMode: 'claude-bypass',
  reasoningEffort: 'max',
  prompt: '',
  ruleIds: [],
  skillIds: ['builtin:canvas-studio'],
  disabledSkillIds: [],
  mcpServerIds: [],
  hookConfig: {},
  metadata: { role: 'canvas-assistant' },
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
} as const

const canvasSession = {
  id: sessionId,
  projectId: context.projectId,
  workspaceIds: [context.workspaceId],
  surface: 'canvas',
  agentId: CANVAS_ASSISTANT_AGENT_ID,
  agentAdapter: 'claude-sdk',
} as const

function makeHarness() {
  const createdSession = {
    id: sessionId,
    title: '画布助手 · Film Project',
    projectId: context.projectId,
    workspaceIds: [context.workspaceId],
    providerProfileId: 'provider-1',
    modelId: 'model-1',
    agentId: CANVAS_ASSISTANT_AGENT_ID,
    agentAdapter: 'codex',
    permissionMode: 'codex-full-access',
    chatMode: 'agent',
    reasoningEffort: 'max',
    status: 'idle',
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    messageCount: 0,
    surface: 'canvas',
  } as const
  const mocks = {
    resolveActiveContext: vi.fn().mockResolvedValue(context),
    getCanvasAssistant: vi.fn().mockReturnValue(assistant),
    listSkills: vi.fn().mockReturnValue([
      { id: 'builtin:canvas-studio', name: '画布工作室', enabled: true },
      { id: 'builtin:multimedia-use', name: '多媒体使用', enabled: true },
      { id: 'builtin:video-workflow', name: '视频工作流', enabled: true },
      { id: 'builtin:platform-manager', name: '平台管理', enabled: true },
      { id: 'local:user-skill', name: '用户技能', enabled: true },
    ]),
    getSessionRecord: vi.fn().mockReturnValue(canvasSession),
    createSession: vi.fn().mockResolvedValue({
      sessionId,
      createdAt: '2026-07-20T00:00:00.000Z',
      session: createdSession,
    }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [createdSession], total: 1 }),
    updateSession: vi.fn().mockResolvedValue({ session: createdSession }),
    submitTurn: vi.fn().mockResolvedValue({ turnId: 'turn-1', accepted: true, started: true }),
    getHistory: vi.fn().mockResolvedValue({ events: [], hasMore: false }),
    cancelTurn: vi.fn().mockResolvedValue({ cancelled: true }),
    answerQuestion: vi.fn().mockResolvedValue(true),
    configureSessionSkills: vi.fn(),
    prepareSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    validateAttachments: vi.fn((_sender, _projectId, attachments) => attachments),
  }
  return {
    mocks,
    createdSession,
    facade: new CanvasAgentSessionFacade(mocks as unknown as CanvasAgentSessionDependencies),
  }
}

describe('Canvas Agent session facade', () => {
  it('reads ownership only from persisted session fields', () => {
    expect(
      toCanvasAgentSessionRecord({
        id: sessionId,
        project_id: context.projectId,
        workspace_ids_json: JSON.stringify([context.workspaceId]),
        metadata_json: JSON.stringify({ surface: 'canvas', team: { enabled: true } }),
        agent_id: CANVAS_ASSISTANT_AGENT_ID,
        agent_adapter: 'codex',
      }),
    ).toEqual({ ...canvasSession, agentAdapter: 'codex' })
    expect(
      toCanvasAgentSessionRecord({
        id: sessionId,
        project_id: context.projectId,
        workspace_ids_json: 'not-json',
        metadata_json: JSON.stringify({ surface: 'legacy' }),
        agent_id: CANVAS_ASSISTANT_AGENT_ID,
        agent_adapter: 'unknown',
      }),
    ).toMatchObject({ workspaceIds: [], surface: undefined, agentAdapter: 'claude-sdk' })
  })

  it('rejects a sender without an active Canvas project before touching sessions', async () => {
    const { facade, mocks } = makeHarness()
    mocks.resolveActiveContext.mockResolvedValue(null)

    await expect(
      facade.createSession({ providerProfileId: 'provider-1' }, sender),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('derives workspace, assistant, surface, permission, and skills during creation', async () => {
    const { facade, mocks } = makeHarness()

    const result = await facade.createSession(
      {
        providerProfileId: 'provider-1',
        modelId: 'model-1',
        agentAdapter: 'codex',
        skillIds: ['builtin:video-workflow'],
      },
      sender,
    )

    expect(mocks.createSession).toHaveBeenCalledWith({
      providerProfileId: 'provider-1',
      modelId: 'model-1',
      agentId: CANVAS_ASSISTANT_AGENT_ID,
      agentAdapter: 'codex',
      permissionMode: 'codex-full-access',
      chatMode: 'agent',
      reasoningEffort: 'max',
      title: '画布助手 · Film Project',
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      surface: 'canvas',
    })
    expect(mocks.configureSessionSkills).toHaveBeenCalledWith(
      sessionId,
      ['builtin:canvas-studio', 'builtin:video-workflow'],
      ['builtin:multimedia-use', 'builtin:platform-manager', 'local:user-skill'],
    )
    expect(result.sessionId).toBe(sessionId)
  })

  it('returns only the fixed assistant and approved Canvas skills', async () => {
    const { facade } = makeHarness()

    const result = await facade.getConfiguration({}, sender)

    expect(result.agents.map((agent) => agent.id)).toEqual([CANVAS_ASSISTANT_AGENT_ID])
    expect(result.skills.map((skill) => skill.id)).toEqual([
      'builtin:canvas-studio',
      'builtin:multimedia-use',
      'builtin:video-workflow',
    ])
  })

  it('derives the workspace and canvas surface when listing and filters legacy agents', async () => {
    const { facade, mocks, createdSession } = makeHarness()
    mocks.listSessions.mockResolvedValue({
      sessions: [createdSession],
      total: 1,
    })

    const result = await facade.listSessions({ includeArchived: false, limit: 20 }, sender)

    expect(mocks.listSessions).toHaveBeenLastCalledWith({
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      surface: 'canvas',
      agentId: CANVAS_ASSISTANT_AGENT_ID,
      includeArchived: false,
      limit: 20,
    })
    expect(result.sessions.map((session) => session.agentId)).toEqual([CANVAS_ASSISTANT_AGENT_ID])
    expect(result.total).toBe(1)
  })

  it('preserves the repository total for paginated Canvas sessions', async () => {
    const { facade, mocks, createdSession } = makeHarness()
    mocks.listSessions.mockResolvedValue({ sessions: [createdSession], total: 7 })

    const result = await facade.listSessions({ limit: 1, offset: 3 }, sender)

    expect(result.sessions).toEqual([createdSession])
    expect(result.total).toBe(7)
  })

  it('authorizes bridge access only after resolving the owned Canvas session', async () => {
    const { facade, mocks } = makeHarness()

    await expect(facade.authorizeSessionAccess(sessionId, sender)).resolves.toEqual(context)
    expect(mocks.getSessionRecord).toHaveBeenCalledWith(sessionId)
  })

  it('keeps sessions isolated when two Canvas projects share one workspace', async () => {
    const { facade, mocks, createdSession } = makeHarness()
    const otherSender = { id: 'other-canvas-window' }
    const otherContext = {
      ...context,
      projectId: 'project-2',
      projectTitle: 'Second Film Project',
    }
    const otherSession = {
      ...createdSession,
      id: '00000000-0000-4000-8000-000000000021',
      projectId: otherContext.projectId,
    }
    mocks.resolveActiveContext.mockImplementation(async (activeSender) =>
      activeSender === otherSender ? otherContext : context,
    )
    mocks.listSessions.mockResolvedValue({
      sessions: [createdSession, otherSession],
      total: 2,
    })

    const firstProject = await facade.listSessions({}, sender)
    const secondProject = await facade.listSessions({}, otherSender)

    expect(mocks.listSessions).toHaveBeenNthCalledWith(1, {
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      surface: 'canvas',
      agentId: CANVAS_ASSISTANT_AGENT_ID,
    })
    expect(mocks.listSessions).toHaveBeenNthCalledWith(2, {
      projectId: otherContext.projectId,
      workspaceId: otherContext.workspaceId,
      surface: 'canvas',
      agentId: CANVAS_ASSISTANT_AGENT_ID,
    })
    expect(firstProject.sessions.map((session) => session.id)).toEqual([createdSession.id])
    expect(secondProject.sessions.map((session) => session.id)).toEqual([otherSession.id])
  })

  it.each([
    ['a general session', { ...canvasSession, surface: undefined }],
    ['another project session', { ...canvasSession, projectId: 'project-2' }],
    ['a session outside the workspace', { ...canvasSession, workspaceIds: ['workspace-2'] }],
    ['an old platform session', { ...canvasSession, agentId: 'platform-manager-agent' }],
  ])('rejects every operation on %s', async (_label, record) => {
    const { facade, mocks } = makeHarness()
    mocks.getSessionRecord.mockReturnValue(record)

    const operations = [
      () => facade.authorizeSessionAccess(sessionId, sender),
      () => facade.updateSession({ sessionId, modelId: 'model-2' }, sender),
      () => facade.submitTurn({ sessionId, message: 'hello' }, sender),
      () => facade.getHistory({ sessionId, full: true }, sender),
      () => facade.cancelSession({ sessionId }, sender),
      () =>
        facade.answerQuestion(
          { sessionId, questionId: 'question-1', answers: { answer: 'yes' } },
          sender,
        ),
    ]

    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    }
    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(mocks.submitTurn).not.toHaveBeenCalled()
    expect(mocks.getHistory).not.toHaveBeenCalled()
    expect(mocks.cancelTurn).not.toHaveBeenCalled()
    expect(mocks.answerQuestion).not.toHaveBeenCalled()
  })

  it('submits only the fixed Canvas runtime fields after ownership validation', async () => {
    const { facade, mocks } = makeHarness()

    await facade.submitTurn(
      {
        sessionId,
        message: 'build a shot list',
        providerProfileId: 'provider-2',
        modelId: 'model-2',
        agentAdapter: 'codex',
      },
      sender,
    )

    expect(mocks.prepareSessionWorkspace).toHaveBeenCalledWith(sessionId)
    expect(mocks.submitTurn).toHaveBeenCalledWith({
      sessionId,
      message: 'build a shot list',
      providerProfileId: 'provider-2',
      modelId: 'model-2',
      agentId: CANVAS_ASSISTANT_AGENT_ID,
      agentAdapter: 'codex',
      permissionMode: 'codex-full-access',
      chatMode: 'agent',
      skillId: 'builtin:canvas-studio',
    })
  })

  it('validates attachment ownership and forwards only canonical paths', async () => {
    const { facade, mocks } = makeHarness()
    const requestedAttachments = [
      { type: 'file' as const, path: '/selected/link-to-script.txt' },
      { type: 'directory' as const, path: '/selected/reference-folder' },
    ]
    const canonicalAttachments = [
      { type: 'file' as const, path: '/canonical/script.txt' },
      { type: 'directory' as const, path: '/canonical/reference-folder' },
    ]
    mocks.validateAttachments.mockReturnValue(canonicalAttachments)

    await facade.submitTurn(
      {
        sessionId,
        message: 'read the references',
        attachments: requestedAttachments,
      },
      sender,
    )

    expect(mocks.validateAttachments).toHaveBeenCalledWith(
      sender,
      context.projectId,
      requestedAttachments,
    )
    expect(mocks.submitTurn).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: canonicalAttachments }),
    )
  })

  it('does not prepare or submit a turn when attachment validation fails', async () => {
    const { facade, mocks } = makeHarness()
    mocks.validateAttachments.mockImplementation(() => {
      throw new Error('attachment path is not allowed')
    })

    await expect(
      facade.submitTurn(
        {
          sessionId,
          message: 'read a secret',
          attachments: [{ type: 'file', path: '/unauthorized/secret.txt' }],
        },
        sender,
      ),
    ).rejects.toThrow(/not allowed/i)

    expect(mocks.prepareSessionWorkspace).not.toHaveBeenCalled()
    expect(mocks.submitTurn).not.toHaveBeenCalled()
  })
})
