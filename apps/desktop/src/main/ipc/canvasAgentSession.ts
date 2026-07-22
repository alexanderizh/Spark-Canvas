import type {
  CanvasAgentConfigurationRequest,
  CanvasAgentConfigurationResponse,
  CanvasAgentSessionAnswerQuestionRequest,
  CanvasAgentSessionCancelRequest,
  CanvasAgentSessionCreateRequest,
  CanvasAgentSessionGetHistoryRequest,
  CanvasAgentSessionListRequest,
  CanvasAgentSessionSubmitTurnRequest,
  CanvasAgentSessionUpdateRequest,
  ManagedAgent,
  SessionAnswerQuestionResponse,
  SessionCancelResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionGetHistoryResponse,
  SessionGetHistoryRequest,
  SessionListRequest,
  SessionListResponse,
  SessionAttachment,
  SessionSubmitTurnRequest,
  SessionSubmitTurnResponse,
  SessionUpdateRequest,
  SessionUpdateResponse,
  SkillItem,
} from '@spark/protocol'
import { CANVAS_ASSISTANT_AGENT_ID, SparkError } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

const REQUIRED_CANVAS_SKILL_ID = 'builtin:canvas-studio'
const CANVAS_AGENT_SKILL_IDS = [
  REQUIRED_CANVAS_SKILL_ID,
  'builtin:multimedia-use',
  'builtin:video-workflow',
] as const
const CANVAS_AGENT_SKILL_ID_SET = new Set<string>(CANVAS_AGENT_SKILL_IDS)

export interface CanvasAgentActiveContext {
  projectId: string
  projectTitle: string
  workspaceId: string
}

export interface CanvasAgentSessionRecord {
  id: string
  projectId: string
  workspaceIds: string[]
  surface: 'canvas' | undefined
  agentId: string
  agentAdapter: 'claude' | 'claude-sdk' | 'codex'
}

interface PersistedCanvasAgentSessionRow {
  id: string
  project_id: string
  workspace_ids_json: string
  metadata_json: string
  agent_id: string
  agent_adapter: string
}

export function toCanvasAgentSessionRecord(
  row: PersistedCanvasAgentSessionRow | null,
): CanvasAgentSessionRecord | null {
  if (row == null) return null
  let workspaceIds: string[] = []
  try {
    const parsed = JSON.parse(row.workspace_ids_json) as unknown
    if (Array.isArray(parsed)) {
      workspaceIds = parsed.filter((value): value is string => typeof value === 'string')
    }
  } catch {
    workspaceIds = []
  }
  let surface: 'canvas' | undefined
  try {
    const metadata = JSON.parse(row.metadata_json) as { surface?: unknown }
    if (metadata.surface === 'canvas') surface = 'canvas'
  } catch {
    surface = undefined
  }
  return {
    id: row.id,
    projectId: row.project_id,
    workspaceIds,
    surface,
    agentId: row.agent_id,
    agentAdapter:
      row.agent_adapter === 'codex'
        ? 'codex'
        : row.agent_adapter === 'claude'
          ? 'claude'
          : 'claude-sdk',
  }
}

export interface CanvasAgentSessionDependencies {
  resolveActiveContext(sender: unknown): Promise<CanvasAgentActiveContext | null>
  getCanvasAssistant(): ManagedAgent | null
  listSkills(): SkillItem[]
  getSessionRecord(sessionId: string): CanvasAgentSessionRecord | null
  createSession(
    request: SessionCreateRequest & { projectId: string },
  ): Promise<SessionCreateResponse>
  listSessions(
    request: SessionListRequest & { projectId: string; agentId: string },
  ): Promise<SessionListResponse>
  updateSession(request: SessionUpdateRequest): Promise<SessionUpdateResponse>
  submitTurn(request: SessionSubmitTurnRequest): Promise<SessionSubmitTurnResponse>
  getHistory(request: SessionGetHistoryRequest): Promise<SessionGetHistoryResponse>
  cancelTurn(sessionId: string): Promise<SessionCancelResponse>
  answerQuestion(
    sessionId: string,
    questionId: string,
    answers: Record<string, unknown>,
  ): Promise<boolean>
  configureSessionSkills(sessionId: string, skillIds: string[], disabledSkillIds: string[]): void
  prepareSessionWorkspace(sessionId: string): Promise<void>
  validateAttachments(
    sender: unknown,
    projectId: string,
    attachments: SessionAttachment[],
  ): SessionAttachment[]
}

export class CanvasAgentSessionFacade {
  constructor(private readonly dependencies: CanvasAgentSessionDependencies) {}

  async getConfiguration(
    _request: CanvasAgentConfigurationRequest,
    sender: unknown,
  ): Promise<CanvasAgentConfigurationResponse> {
    await this.requireContext(sender)
    const assistant = this.requireCanvasAssistant()
    const skills = this.dependencies
      .listSkills()
      .filter((skill) => skill.enabled && CANVAS_AGENT_SKILL_ID_SET.has(skill.id))
    return { agents: [assistant], skills }
  }

  async authorizeSessionAccess(
    sessionId: string,
    sender: unknown,
  ): Promise<CanvasAgentActiveContext> {
    const context = await this.requireContext(sender)
    this.requireOwnedSession(context, sessionId)
    return context
  }

  async createSession(
    request: CanvasAgentSessionCreateRequest,
    sender: unknown,
  ): Promise<SessionCreateResponse> {
    const context = await this.requireContext(sender)
    const assistant = this.requireCanvasAssistant()
    const agentAdapter = normalizeCanvasAgentAdapter(request.agentAdapter ?? assistant.agentAdapter)
    const response = await this.dependencies.createSession({
      providerProfileId: request.providerProfileId,
      ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
      agentId: CANVAS_ASSISTANT_AGENT_ID,
      agentAdapter,
      permissionMode: permissionModeForAdapter(agentAdapter),
      chatMode: 'agent',
      reasoningEffort: assistant.reasoningEffort,
      title: `画布助手 · ${context.projectTitle}`,
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      surface: 'canvas',
    })
    this.configureSessionSkills(response.sessionId, request.skillIds)
    return response
  }

  async listSessions(
    request: CanvasAgentSessionListRequest,
    sender: unknown,
  ): Promise<SessionListResponse> {
    const context = await this.requireContext(sender)
    const result = await this.dependencies.listSessions({
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      surface: 'canvas',
      agentId: CANVAS_ASSISTANT_AGENT_ID,
      ...(request.includeArchived !== undefined
        ? { includeArchived: request.includeArchived }
        : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.offset !== undefined ? { offset: request.offset } : {}),
    })
    const sessions = result.sessions.filter(
      (session) =>
        session.surface === 'canvas' &&
        session.agentId === CANVAS_ASSISTANT_AGENT_ID &&
        session.projectId === context.projectId &&
        session.workspaceIds.includes(context.workspaceId),
    )
    return { sessions, total: result.total }
  }

  async updateSession(
    request: CanvasAgentSessionUpdateRequest,
    sender: unknown,
  ): Promise<SessionUpdateResponse> {
    const context = await this.requireContext(sender)
    const session = this.requireOwnedSession(context, request.sessionId)
    const agentAdapter = normalizeCanvasAgentAdapter(request.agentAdapter ?? session.agentAdapter)
    const response = await this.dependencies.updateSession({
      sessionId: request.sessionId as SessionUpdateRequest['sessionId'],
      ...(request.providerProfileId !== undefined
        ? { providerProfileId: request.providerProfileId }
        : {}),
      ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
      agentId: CANVAS_ASSISTANT_AGENT_ID,
      agentAdapter,
      permissionMode: permissionModeForAdapter(agentAdapter),
      chatMode: 'agent',
    })
    if (request.skillIds !== undefined) {
      this.configureSessionSkills(request.sessionId, request.skillIds)
    }
    return response
  }

  async submitTurn(
    request: CanvasAgentSessionSubmitTurnRequest,
    sender: unknown,
  ): Promise<SessionSubmitTurnResponse> {
    const context = await this.requireContext(sender)
    const session = this.requireOwnedSession(context, request.sessionId)
    const attachments =
      request.attachments === undefined
        ? undefined
        : this.dependencies.validateAttachments(sender, context.projectId, request.attachments)
    await this.dependencies.prepareSessionWorkspace(request.sessionId)
    const agentAdapter = normalizeCanvasAgentAdapter(request.agentAdapter ?? session.agentAdapter)
    return this.dependencies.submitTurn({
      sessionId: request.sessionId as SessionSubmitTurnRequest['sessionId'],
      message: request.message,
      ...(request.providerProfileId !== undefined
        ? { providerProfileId: request.providerProfileId }
        : {}),
      ...(request.modelId !== undefined ? { modelId: request.modelId } : {}),
      ...(attachments !== undefined ? { attachments } : {}),
      agentId: CANVAS_ASSISTANT_AGENT_ID,
      agentAdapter,
      permissionMode: permissionModeForAdapter(agentAdapter),
      chatMode: 'agent',
      skillId: REQUIRED_CANVAS_SKILL_ID,
    })
  }

  async getHistory(
    request: CanvasAgentSessionGetHistoryRequest,
    sender: unknown,
  ): Promise<SessionGetHistoryResponse> {
    const context = await this.requireContext(sender)
    this.requireOwnedSession(context, request.sessionId)
    return this.dependencies.getHistory({
      sessionId: request.sessionId as SessionGetHistoryRequest['sessionId'],
      ...(request.full !== undefined ? { full: request.full } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.turnLimit !== undefined ? { turnLimit: request.turnLimit } : {}),
      ...(request.eventLimit !== undefined ? { eventLimit: request.eventLimit } : {}),
      ...(request.beforeSeq !== undefined ? { beforeSeq: request.beforeSeq } : {}),
    })
  }

  async cancelSession(
    request: CanvasAgentSessionCancelRequest,
    sender: unknown,
  ): Promise<SessionCancelResponse> {
    const context = await this.requireContext(sender)
    this.requireOwnedSession(context, request.sessionId)
    return this.dependencies.cancelTurn(request.sessionId)
  }

  async answerQuestion(
    request: CanvasAgentSessionAnswerQuestionRequest,
    sender: unknown,
  ): Promise<SessionAnswerQuestionResponse> {
    const context = await this.requireContext(sender)
    this.requireOwnedSession(context, request.sessionId)
    if (
      !(await this.dependencies.answerQuestion(
        request.sessionId,
        request.questionId,
        request.answers,
      ))
    ) {
      throw new SparkError('NOT_FOUND', '该提问已结束或不属于当前画布会话。')
    }
    return { ok: true }
  }

  private async requireContext(sender: unknown): Promise<CanvasAgentActiveContext> {
    const context = await this.dependencies.resolveActiveContext(sender)
    if (context == null) {
      throw new SparkError('PERMISSION_DENIED', '当前窗口无权访问画布 Agent 会话。')
    }
    return context
  }

  private requireCanvasAssistant(): ManagedAgent {
    const assistant = this.dependencies.getCanvasAssistant()
    if (
      assistant == null ||
      assistant.id !== CANVAS_ASSISTANT_AGENT_ID ||
      !assistant.builtIn ||
      !assistant.enabled
    ) {
      throw new SparkError('NOT_FOUND', '内置画布助手不可用。')
    }
    return assistant
  }

  private requireOwnedSession(
    context: CanvasAgentActiveContext,
    sessionId: string,
  ): CanvasAgentSessionRecord {
    const session = this.dependencies.getSessionRecord(sessionId)
    if (session == null) {
      throw new SparkError('NOT_FOUND', '画布 Agent 会话不存在。')
    }
    if (
      session.surface !== 'canvas' ||
      session.agentId !== CANVAS_ASSISTANT_AGENT_ID ||
      session.projectId !== context.projectId ||
      !session.workspaceIds.includes(context.workspaceId)
    ) {
      throw new SparkError('PERMISSION_DENIED', '当前画布无权访问该 Agent 会话。')
    }
    return session
  }

  private configureSessionSkills(sessionId: string, requestedSkillIds: string[] | undefined): void {
    const requested = requestedSkillIds ?? []
    const invalid = requested.find((skillId) => !CANVAS_AGENT_SKILL_ID_SET.has(skillId))
    if (invalid != null) {
      throw new SparkError('PERMISSION_DENIED', `画布 Agent 不允许使用 Skill：${invalid}`)
    }
    const skillIds = Array.from(new Set([REQUIRED_CANVAS_SKILL_ID, ...requested]))
    const disabledSkillIds = Array.from(
      new Set(
        this.dependencies
          .listSkills()
          .map((skill) => skill.id)
          .filter((skillId) => !skillIds.includes(skillId)),
      ),
    )
    this.dependencies.configureSessionSkills(sessionId, skillIds, disabledSkillIds)
  }
}

function normalizeCanvasAgentAdapter(
  adapter: 'claude' | 'claude-sdk' | 'codex',
): 'claude-sdk' | 'codex' {
  return adapter === 'codex' ? 'codex' : 'claude-sdk'
}

function permissionModeForAdapter(adapter: 'claude-sdk' | 'codex') {
  return adapter === 'codex' ? ('codex-full-access' as const) : ('claude-bypass' as const)
}

export function registerCanvasAgentSessionIpc(
  dependencies: CanvasAgentSessionDependencies,
): CanvasAgentSessionFacade {
  const facade = new CanvasAgentSessionFacade(dependencies)
  typedIpcHandle('canvas:agent:configuration', (request, event) =>
    facade.getConfiguration(request, event.sender),
  )
  typedIpcHandle('canvas:agent:session:create', (request, event) =>
    facade.createSession(request, event.sender),
  )
  typedIpcHandle('canvas:agent:session:list', (request, event) =>
    facade.listSessions(request, event.sender),
  )
  typedIpcHandle('canvas:agent:session:update', (request, event) =>
    facade.updateSession(request, event.sender),
  )
  typedIpcHandle('canvas:agent:session:submit-turn', (request, event) =>
    facade.submitTurn(request, event.sender),
  )
  typedIpcHandle('canvas:agent:session:get-history', (request, event) =>
    facade.getHistory(request, event.sender),
  )
  typedIpcHandle('canvas:agent:session:cancel', (request, event) =>
    facade.cancelSession(request, event.sender),
  )
  typedIpcHandle('canvas:agent:session:answer-question', (request, event) =>
    facade.answerQuestion(request, event.sender),
  )
  return facade
}
