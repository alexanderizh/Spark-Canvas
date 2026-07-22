import { z } from 'zod'

export const CanvasAgentOpenWorkspaceRequestSchema = z
  .object({
    projectId: z.string().min(1).max(200),
  })
  .strict()

export type CanvasAgentOpenWorkspaceRequest = z.infer<typeof CanvasAgentOpenWorkspaceRequestSchema>

export interface CanvasAgentOpenWorkspaceResponse {
  workspaceId: string
}

declare module './ipc/index.js' {
  interface IpcChannelMap {
    'canvas:agent:open-workspace': [
      CanvasAgentOpenWorkspaceRequest,
      CanvasAgentOpenWorkspaceResponse,
    ]
  }
}
