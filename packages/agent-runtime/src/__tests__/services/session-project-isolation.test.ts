import { describe, expect, it, vi } from 'vitest'
import { SessionRepository, type SessionRow, type SparkDatabase } from '@spark/storage'

import { SessionService } from '../../services/session.service.js'

function createBareSessionService(): SessionService {
  const service = Object.create(SessionService.prototype) as {
    db: SparkDatabase
    resolveAgent: () => {
      id: string
      providerProfileId: string
      modelId: null
      agentAdapter: 'claude-sdk'
      permissionMode: 'claude-ask'
      reasoningEffort: 'max'
    }
    updateSession: () => Promise<{ session: never }>
    createSession: SessionService['createSession']
  }
  service.db = {} as SparkDatabase
  service.resolveAgent = () => ({
    id: 'canvas-assistant-agent',
    providerProfileId: 'provider-1',
    modelId: null,
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-ask',
    reasoningEffort: 'max',
  })
  service.updateSession = vi.fn().mockResolvedValue({ session: {} as never })
  return service as unknown as SessionService
}

function spyOnSessionCreate() {
  return vi.spyOn(SessionRepository.prototype, 'create').mockImplementation(
    (params) =>
      ({
        id: params.id,
        project_id: params.projectId,
        workspace_ids_json: JSON.stringify(params.workspaceIds ?? []),
        created_at: '2026-07-21T00:00:00.000Z',
      }) as SessionRow,
  )
}

describe('SessionService project isolation', () => {
  it('persists the explicit project id independently from the workspace id', async () => {
    const create = spyOnSessionCreate()
    const service = createBareSessionService()

    try {
      await service.createSession({
        providerProfileId: 'provider-1',
        projectId: 'project-1',
        workspaceId: 'shared-workspace',
      })

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-1',
          workspaceIds: ['shared-workspace'],
        }),
      )
    } finally {
      create.mockRestore()
    }
  })

  it.each([
    ['falls back to the workspace id', { workspaceId: 'workspace-only' }, 'workspace-only', ['workspace-only']],
    ['falls back to default without a workspace', {}, 'default', []],
  ])('%s', async (_label, input, expectedProjectId, expectedWorkspaceIds) => {
    const create = spyOnSessionCreate()
    const service = createBareSessionService()

    try {
      await service.createSession({
        providerProfileId: 'provider-1',
        ...input,
      })

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: expectedProjectId,
          workspaceIds: expectedWorkspaceIds,
        }),
      )
    } finally {
      create.mockRestore()
    }
  })
})
