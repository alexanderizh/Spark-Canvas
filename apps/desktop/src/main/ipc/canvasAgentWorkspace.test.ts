import { describe, expect, it, vi } from 'vitest'

import { openCanvasAgentWorkspace } from './canvasAgentWorkspace.js'

const workspaceRow = {
  id: 'workspace-1',
  name: 'Film Project',
  root_path: '/canvas/projects/film-project',
  pinned_at: null,
  archived_at: null,
  created_at: '2026-07-20T00:00:00.000Z',
  updated_at: '2026-07-20T00:00:00.000Z',
  worktree_meta_json: null,
}

describe('Canvas Agent workspace facade', () => {
  it('opens the authoritative directory stored for the Canvas project', async () => {
    const sender = {}
    const openWorkspace = vi.fn().mockResolvedValue(workspaceRow)

    const result = await openCanvasAgentWorkspace({ projectId: 'project-1' }, sender, {
      getActiveProjectIdForSender: vi.fn().mockReturnValue('project-1'),
      findProject: vi.fn().mockReturnValue({
        id: 'project-1',
        title: 'Film Project',
        status: 'active',
        root_path: '/canvas/projects/film-project',
      }),
      openWorkspace,
    })

    expect(openWorkspace).toHaveBeenCalledWith('/canvas/projects/film-project', 'Film Project', {
      create: false,
    })
    expect(result).toEqual({ workspaceId: 'workspace-1' })
  })

  it.each([null, 'project-2'])('rejects a sender bound to project %s', async (activeProjectId) => {
    const findProject = vi.fn()
    const openWorkspace = vi.fn()

    await expect(
      openCanvasAgentWorkspace(
        { projectId: 'project-1' },
        {},
        {
          getActiveProjectIdForSender: vi.fn().mockReturnValue(activeProjectId),
          findProject,
          openWorkspace,
        },
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })

    expect(findProject).not.toHaveBeenCalled()
    expect(openWorkspace).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null],
    [
      'deleted',
      {
        id: 'project-1',
        title: 'Film Project',
        status: 'deleted',
        root_path: '/canvas/projects/film-project',
      },
    ],
    [
      'without a directory',
      { id: 'project-1', title: 'Film Project', status: 'active', root_path: null },
    ],
    [
      'with a relative directory',
      {
        id: 'project-1',
        title: 'Film Project',
        status: 'active',
        root_path: 'relative/film-project',
      },
    ],
  ])('rejects a %s Canvas project', async (_label, project) => {
    const openWorkspace = vi.fn()

    await expect(
      openCanvasAgentWorkspace(
        { projectId: 'project-1' },
        {},
        {
          getActiveProjectIdForSender: vi.fn().mockReturnValue('project-1'),
          findProject: vi.fn().mockReturnValue(project),
          openWorkspace,
        },
      ),
    ).rejects.toThrow()

    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
