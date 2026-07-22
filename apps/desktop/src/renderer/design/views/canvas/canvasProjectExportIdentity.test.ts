// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi, type CanvasDb } from './canvas.api'
import type { CanvasSnapshot } from './canvas.types'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-20T00:00:00.000Z'

function snapshot(): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: '视频项目',
      status: 'active' as const,
      rootPath: '/tmp/project-1',
      settings: {},
      nodeCount: 0,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: 'Main canvas',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
}

function seedProject(): void {
  const value = snapshot()
  const db: CanvasDb = {
    projects: [value.project],
    boards: [value.board],
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('Canvas project export identity', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
  })

  it('writes spark-canvas as the machine identity in new JSON exports', async () => {
    seedProject()
    const invoke = vi.fn(async (channel: string, _request?: unknown) => {
      if (channel === 'dialog:save-file') {
        return { canceled: false, filePath: '/tmp/video.spark-canvas.json' }
      }
      if (channel === 'file:write-text') return {}
      throw new Error(`Unexpected IPC channel: ${channel}`)
    })
    Object.assign(window, { spark: { invoke } })

    await canvasApi.exportProjectToFile('project-1')

    const writeCall = invoke.mock.calls.find(([channel]) => channel === 'file:write-text')
    if (!writeCall) throw new Error('Expected file:write-text to be invoked')
    const writeRequest = writeCall[1] as { content: string }
    expect(JSON.parse(writeRequest.content)).toMatchObject({
      kind: 'spark.canvas.project',
      app: 'spark-canvas',
    })
  })

  it.each(['Spark-Agent', 'spark-agent', 'spark-canvas'])(
    'imports project files written with the %s identity',
    async (appIdentity) => {
      const content = JSON.stringify({
        kind: 'spark.canvas.project',
        version: 2,
        exportedAt: at,
        app: appIdentity,
        snapshot: snapshot(),
      })
      const invoke = vi.fn(async (channel: string, request?: { snapshotJson?: string }) => {
        if (channel === 'dialog:open-file') {
          return { canceled: false, filePath: '/tmp/import.spark-canvas.json' }
        }
        if (channel === 'file:read-text') return { content }
        if (channel === 'canvas:project:ensure-directory') {
          return { rootPath: '/tmp/imported-project' }
        }
        if (channel === 'canvas:project:migrate-assets') {
          return { movedAssets: 0, skippedAssets: 0, snapshotJson: request?.snapshotJson ?? '{}' }
        }
        if (channel === 'canvas:snapshot:save') return {}
        throw new Error(`Unexpected IPC channel: ${channel}`)
      })
      Object.assign(window, { spark: { invoke } })

      const imported = await canvasApi.importProjectFromFile()

      expect(imported?.project.title).toBe('视频项目（导入）')
      expect(imported?.project.rootPath).toBe('/tmp/imported-project')
    },
  )

  it('does not read absolute or safe-file references from legacy JSON imports', async () => {
    const value = snapshot()
    value.assets.push({
      id: 'asset-1',
      projectId: 'project-1',
      userId: 0,
      type: 'video',
      source: 'imported',
      title: 'clip',
      storageKey: '/etc/passwd',
      url: 'safe-file://local/L2V0Yy9wYXNzd2Q=',
      thumbnailKey: null,
      thumbnailUrl: null,
      contentText: null,
      metadata: { filePath: '/etc/passwd' },
      createdAt: at,
      updatedAt: at,
    })
    const content = JSON.stringify({
      kind: 'spark.canvas.project',
      version: 2,
      exportedAt: at,
      app: 'Spark-Agent',
      snapshot: value,
    })
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'dialog:open-file') {
        return { canceled: false, filePath: '/tmp/untrusted.spark-canvas.json' }
      }
      if (channel === 'file:read-text') return { content }
      if (channel === 'canvas:project:ensure-directory') {
        return { rootPath: '/tmp/imported-project' }
      }
      if (channel === 'canvas:snapshot:save') return {}
      throw new Error(`Unexpected IPC channel: ${channel}`)
    })
    Object.assign(window, { spark: { invoke } })

    const imported = await canvasApi.importProjectFromFile()

    expect(invoke).not.toHaveBeenCalledWith('canvas:project:migrate-assets', expect.anything())
    expect(imported?.assets[0]).toMatchObject({
      storageKey: null,
      url: null,
      metadata: expect.not.objectContaining({ filePath: expect.anything() }),
    })
    expect(imported?.project.metadata?.importWarnings).toEqual([expect.stringContaining('clip')])
  })

  it('imports a verified directory package through the main-process boundary', async () => {
    const importDirectory = (
      canvasApi as typeof canvasApi & {
        importProjectFromDirectory?: (
          sourceDirectory: string,
          targetParentDirectory?: string,
        ) => Promise<ReturnType<typeof snapshot>>
      }
    ).importProjectFromDirectory
    expect(importDirectory).toBeTypeOf('function')
    if (!importDirectory) return

    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'canvas:project:import-package') {
        return {
          rootPath: '/tmp/imported-directory-project',
          snapshotJson: JSON.stringify(snapshot()),
          warnings: [],
        }
      }
      if (channel === 'canvas:snapshot:save') return {}
      throw new Error(`Unexpected IPC channel: ${channel} ${JSON.stringify(request)}`)
    })
    Object.assign(window, { spark: { invoke } })

    const imported = await importDirectory('/tmp/source-package', '/tmp/projects')

    expect(invoke).toHaveBeenCalledWith('canvas:project:import-package', {
      sourceDirectory: '/tmp/source-package',
      targetParentDirectory: '/tmp/projects',
    })
    expect(imported.project.id).not.toBe('project-1')
    expect(imported.project.rootPath).toBe('/tmp/imported-directory-project')
  })
})
