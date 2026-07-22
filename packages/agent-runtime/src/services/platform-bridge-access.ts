export type PlatformBridgeCapability = 'platform' | 'canvas' | 'memory'

const LEGACY_PLATFORM_METHODS = new Set([
  'agents.create',
  'agents.delete',
  'agents.get',
  'agents.list',
  'agents.update',
  'artifacts.list',
  'artifacts.resolve',
  'board.batch_create',
  'board.batch_delete',
  'board.batch_update',
  'board.create',
  'board.delete',
  'board.get',
  'board.list',
  'board.permanent_delete',
  'board.restore',
  'board.update',
  'github.comment_issue',
  'github.comment_pull_request',
  'github.create_branch',
  'github.create_issue',
  'github.create_pull_request',
  'github.get_issue',
  'github.get_pull_request',
  'github.get_repository',
  'github.list_issues',
  'github.list_pull_requests',
  'github.list_repositories',
  'github.read_repository_file',
  'github.status',
  'github.update_issue',
  'github.upsert_repository_file',
  'mcp.create',
  'mcp.delete',
  'mcp.list',
  'mcp.status',
  'mcp.update',
  'providers.create',
  'providers.delete',
  'providers.get',
  'providers.health_check',
  'providers.list',
  'providers.set_default',
  'providers.set_default_model',
  'providers.update',
  'sessions.get',
  'sessions.switch_mode',
  'sessions.switch_model',
  'sessions.switch_permission',
  'sessions.switch_provider',
  'sessions.switch_reasoning_effort',
  'settings.get',
  'settings.get_all',
  'settings.get_category',
  'settings.set',
  'skills.install',
  'skills.install_github',
  'skills.list',
  'skills.load',
  'skills.search',
  'skills.search_github',
  'skills.toggle',
  'skills.uninstall',
  'teams.create',
  'teams.delete',
  'teams.get',
  'teams.list',
  'teams.update',
  'workflows.create',
  'workflows.delete',
  'workflows.get',
  'workflows.list',
  'workflows.update',
])

const CAPABILITY_METHODS: Record<PlatformBridgeCapability, ReadonlySet<string>> = {
  platform: LEGACY_PLATFORM_METHODS,
  canvas: new Set(['canvas.call_tool']),
  memory: new Set(['memory.search', 'memory.recall']),
}

const SESSION_BOUND_METHODS = new Set([
  'canvas.call_tool',
  'memory.search',
  'memory.recall',
  'sessions.get',
  'sessions.switch_mode',
  'sessions.switch_model',
  'sessions.switch_permission',
  'sessions.switch_provider',
  'sessions.switch_reasoning_effort',
])

export interface PlatformBridgeAccessGrant {
  capability: PlatformBridgeCapability
  sessionId: string
  canvasToolNames: ReadonlySet<string> | null
  expiresAt: number
}

export function isPlatformBridgeRequestAllowed(
  grant: PlatformBridgeAccessGrant,
  method: string,
  params: Record<string, unknown>,
): boolean {
  if (!CAPABILITY_METHODS[grant.capability].has(method)) return false
  if (SESSION_BOUND_METHODS.has(method) && String(params.sessionId ?? '') !== grant.sessionId) {
    return false
  }
  if (method === 'canvas.call_tool') {
    return grant.canvasToolNames?.has(String(params.toolName ?? '')) === true
  }
  return true
}
