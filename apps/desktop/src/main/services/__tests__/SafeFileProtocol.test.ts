import { describe, expect, it, vi } from 'vitest'
import { join, resolve } from 'node:path'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const workspaceRoot = join('G:', 'spark', 'spark-agent')
const canvasRoot = join('G:', 'spark', 'canvas-project')
const databaseState = vi.hoisted(() => ({ settingsRows: [] as Array<{ value: string }> }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return join('C:', 'Users', 'Test', 'AppData', 'Roaming', 'SparkAgent')
      if (name === 'temp') return join('C:', 'Users', 'Test', 'AppData', 'Local', 'Temp')
      return ''
    },
  },
  net: {
    fetch: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}))

vi.mock('../../db.js', () => ({
  getDatabase: () => ({
    raw: {
      prepare: (sql: string) => ({
        all: () =>
          sql.includes('app_settings')
            ? databaseState.settingsRows
            : sql.includes('canvas_projects')
              ? [{ root_path: canvasRoot }]
              : [{ root_path: workspaceRoot }],
      }),
    },
  }),
}))

import {
  createSafeFileResponse,
  getSafeFileAllowedRoots,
  isSafeFilePathAllowed,
} from '../SafeFileProtocol.js'
import { CANVAS_PROJECTS_ROOT_GRANT_VERSION } from '../CanvasProjectsRootSetting.js'

describe('SafeFileProtocol', () => {
  it('allows app-owned media artifacts only under the dedicated media directory', () => {
    const artifactPath = join(
      'C:',
      'Users',
      'Test',
      'AppData',
      'Roaming',
      'SparkAgent',
      '.spark-artifacts',
      'media',
      'tang-princess.png',
    )

    expect(isSafeFilePathAllowed(artifactPath)).toBe(true)
  })

  it('does not expose registered workspace files to the standalone Canvas renderer', () => {
    const previewablePdf = join(workspaceRoot, 'preview-test', 'sample.pdf')

    expect(isSafeFilePathAllowed(previewablePdf)).toBe(false)
  })

  it('does not allow files outside registered workspaces', () => {
    const outsideFile = join('C:', 'Users', 'Test', '.ssh', 'id_rsa')

    expect(isSafeFilePathAllowed(outsideFile)).toBe(false)
  })

  it('exposes only Canvas asset and thumbnail subdirectories, not the whole project root', () => {
    const roots = getSafeFileAllowedRoots()

    expect(roots).toContain(resolve(canvasRoot, 'assets'))
    expect(roots).toContain(resolve(canvasRoot, 'thumbnails'))
    expect(roots).not.toContain(resolve(canvasRoot))
    expect(roots).not.toContain(resolve(workspaceRoot))
  })

  it('never turns a configured default projects root into a SafeFile read root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'safe-file-canvas-root-'))
    const canonical = realpathSync.native(dir)
    const configured = resolve(dir)
    try {
      databaseState.settingsRows = [
        { value: JSON.stringify({ projectsRootPath: dir }) },
      ]
      expect(getSafeFileAllowedRoots()).not.toContain(configured)
      expect(getSafeFileAllowedRoots()).not.toContain(canonical)

      databaseState.settingsRows = [
        {
          value: JSON.stringify({
            projectsRootPath: dir,
            projectsRootPathGrantVersion: CANVAS_PROJECTS_ROOT_GRANT_VERSION,
          }),
        },
      ]
      expect(getSafeFileAllowedRoots()).not.toContain(configured)
      expect(getSafeFileAllowedRoots()).not.toContain(canonical)
    } finally {
      databaseState.settingsRows = []
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serves video range requests with partial content headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'safe-file-test-'))
    const file = join(dir, 'clip.mp4')
    writeFileSync(file, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))

    try {
      const request = new Request('safe-file://x/test', {
        headers: { range: 'bytes=2-5' },
      })
      const response = createSafeFileResponse(file, request)

      expect(response.status).toBe(206)
      expect(response.headers.get('content-type')).toBe('video/mp4')
      expect(response.headers.get('accept-ranges')).toBe('bytes')
      expect(response.headers.get('content-range')).toBe('bytes 2-5/8')
      expect(response.headers.get('content-length')).toBe('4')
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4, 5])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
