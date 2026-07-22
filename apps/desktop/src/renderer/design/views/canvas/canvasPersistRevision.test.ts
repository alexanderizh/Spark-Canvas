// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCanvasHotCache,
  canvasApi,
  isCanvasDirty,
  saveCanvas,
  type CanvasDb,
} from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-20T00:00:00.000Z'

function seedProject(): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: 'Film',
        status: 'active',
        rootPath: '/tmp/project-1',
        settings: {},
        nodeCount: 0,
        assetCount: 0,
        taskCount: 0,
        createdAt: at,
        updatedAt: at,
      },
    ],
    boards: [
      {
        id: 'board-1',
        projectId: 'project-1',
        userId: 0,
        name: 'Board',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('Canvas save mutation revision', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    seedProject()
  })

  it('keeps a project dirty when it changes while an earlier snapshot is saving', async () => {
    let releaseFirstSave: (() => void) | undefined
    let saveCount = 0
    const invoke = vi.fn((channel: string) => {
      if (channel !== 'canvas:snapshot:save') return Promise.resolve({})
      saveCount += 1
      if (saveCount > 1) return Promise.resolve({ saved: true, updatedAt: at })
      return new Promise((resolve) => {
        releaseFirstSave = () => resolve({ saved: true, updatedAt: at })
      })
    })
    Object.assign(window, { spark: { invoke, on: vi.fn(() => vi.fn()) } })

    await canvasApi.updateViewport('project-1', { x: 10, y: 20, zoom: 1 })
    const saving = saveCanvas()
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('canvas:snapshot:save', expect.anything()),
    )

    await canvasApi.updateViewport('project-1', { x: 30, y: 40, zoom: 1.2 })
    releaseFirstSave?.()

    await expect(saving).resolves.toBe(true)
    expect(isCanvasDirty('project-1')).toBe(true)

    await expect(saveCanvas()).resolves.toBe(true)
    expect(isCanvasDirty('project-1')).toBe(false)
  })
})
