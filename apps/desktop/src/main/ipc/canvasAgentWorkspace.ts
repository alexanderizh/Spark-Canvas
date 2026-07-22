import path from 'node:path'

import type {
  CanvasAgentOpenWorkspaceRequest,
  CanvasAgentOpenWorkspaceResponse,
} from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

interface CanvasAgentProjectRecord {
  id: string
  title: string
  status: 'active' | 'archived' | 'deleted'
  root_path: string | null
}

interface CanvasAgentWorkspaceRecord {
  id: string
}

export interface CanvasAgentWorkspaceDependencies {
  getActiveProjectIdForSender(sender: unknown): string | null
  findProject(projectId: string): CanvasAgentProjectRecord | null
  openWorkspace(
    rootPath: string,
    name: string,
    params: { create: false },
  ): Promise<CanvasAgentWorkspaceRecord>
}

export async function openCanvasAgentWorkspace(
  request: CanvasAgentOpenWorkspaceRequest,
  sender: unknown,
  dependencies: CanvasAgentWorkspaceDependencies,
): Promise<CanvasAgentOpenWorkspaceResponse> {
  if (dependencies.getActiveProjectIdForSender(sender) !== request.projectId) {
    throw new SparkError('PERMISSION_DENIED', '当前窗口无权打开该画布项目工作区。')
  }

  const project = dependencies.findProject(request.projectId)
  if (project == null || project.status === 'deleted') {
    throw new SparkError('NOT_FOUND', `Canvas project not found: ${request.projectId}`)
  }

  const rootPath = project.root_path?.trim()
  if (!rootPath || !path.isAbsolute(rootPath)) {
    throw new SparkError(
      'WORKSPACE_NOT_FOUND',
      `Canvas project has no valid directory: ${request.projectId}`,
    )
  }

  const workspace = await dependencies.openWorkspace(rootPath, project.title, { create: false })
  return { workspaceId: workspace.id }
}

export function registerCanvasAgentWorkspaceIpc(
  dependencies: CanvasAgentWorkspaceDependencies,
): void {
  typedIpcHandle('canvas:agent:open-workspace', async (request, event) => {
    return openCanvasAgentWorkspace(request, event.sender, dependencies)
  })
}
