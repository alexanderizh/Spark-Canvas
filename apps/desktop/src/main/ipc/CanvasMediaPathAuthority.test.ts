import path from 'node:path'

import type { CanvasMediaTaskCreateRequest } from '@spark/protocol'
import { SparkError } from '@spark/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  authorizeCanvasMediaRequestPaths,
  type CanvasMediaPathAuthorityDependencies,
} from './CanvasMediaPathAuthority.js'

const SENDER = { id: 'canvas-window' }
const PROJECT_ID = 'project-1'
const PROJECT_ROOT = path.resolve('test-fixtures', PROJECT_ID)

function request(
  overrides: Partial<CanvasMediaTaskCreateRequest> = {},
): CanvasMediaTaskCreateRequest {
  return {
    projectId: PROJECT_ID,
    operation: 'text_to_video',
    prompt: 'A quiet street at sunrise',
    ...overrides,
  }
}

function dependencies(
  overrides: Partial<CanvasMediaPathAuthorityDependencies> = {},
): CanvasMediaPathAuthorityDependencies {
  return {
    findProject: () => ({ status: 'active', root_path: PROJECT_ROOT }),
    isActiveProject: (_sender, projectId) => projectId === PROJECT_ID,
    resolveReadableFile: (_sender, filePath) => path.resolve(filePath),
    ...overrides,
  }
}

function safeFileUrl(filePath: string): string {
  return `safe-file://x/${Buffer.from(filePath, 'utf8').toString('base64url')}`
}

describe('authorizeCanvasMediaRequestPaths', () => {
  it('requires a non-empty projectId before resolving any project state', () => {
    const deps = dependencies({
      findProject: vi.fn(() => ({ status: 'active', root_path: PROJECT_ROOT })),
      isActiveProject: vi.fn(() => true),
    })
    const missingProjectId = request()
    delete missingProjectId.projectId

    expect(() =>
      authorizeCanvasMediaRequestPaths(missingProjectId, SENDER, deps),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(deps.isActiveProject).not.toHaveBeenCalled()
    expect(deps.findProject).not.toHaveBeenCalled()
  })

  it('rejects a sender bound to another Canvas project', () => {
    const deps = dependencies({
      findProject: vi.fn(() => ({ status: 'active', root_path: PROJECT_ROOT })),
      isActiveProject: vi.fn(() => false),
    })

    expect(() => authorizeCanvasMediaRequestPaths(request(), SENDER, deps)).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
    expect(deps.isActiveProject).toHaveBeenCalledWith(SENDER, PROJECT_ID)
    expect(deps.findProject).not.toHaveBeenCalled()
  })

  it('rejects a missing project', () => {
    const deps = dependencies({ findProject: () => null })

    expect(() => authorizeCanvasMediaRequestPaths(request(), SENDER, deps)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    )
  })

  it.each([
    [{ status: 'archived' as const, root_path: PROJECT_ROOT }, 'PERMISSION_DENIED'],
    [{ status: 'deleted' as const, root_path: PROJECT_ROOT }, 'PERMISSION_DENIED'],
    [{ status: 'active' as const, root_path: null }, 'WORKSPACE_NOT_FOUND'],
    [{ status: 'active' as const, root_path: 'relative/project' }, 'WORKSPACE_NOT_FOUND'],
  ])('requires an active project with an absolute DB root: %o', (project, code) => {
    const deps = dependencies({ findProject: () => project })

    expect(() => authorizeCanvasMediaRequestPaths(request(), SENDER, deps)).toThrowError(
      expect.objectContaining({ code }),
    )
  })

  it('derives outputDir from the DB project root and preserves other request fields', () => {
    const original = request({
      clientTaskId: 'renderer-task-1',
      modelId: 'video-model',
      modelParams: { duration: 5 },
      waitForCompletion: false,
    })

    const authorized = authorizeCanvasMediaRequestPaths(original, SENDER, dependencies())

    expect(authorized).toEqual({
      ...original,
      outputDir: path.join(PROJECT_ROOT, 'assets'),
    })
    expect(original.outputDir).toBeUndefined()
  })

  it('rejects renderer outputDir injection but accepts the exact derived directory', () => {
    const deps = dependencies()

    expect(() =>
      authorizeCanvasMediaRequestPaths(
        request({ outputDir: path.resolve('outside', 'assets') }),
        SENDER,
        deps,
      ),
    ).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))

    expect(
      authorizeCanvasMediaRequestPaths(
        request({ outputDir: path.join(PROJECT_ROOT, 'assets') }),
        SENDER,
        deps,
      ).outputDir,
    ).toBe(path.join(PROJECT_ROOT, 'assets'))
  })

  it('replaces each input path with the authorized canonical file path', () => {
    const selectedPath = path.join(PROJECT_ROOT, 'assets', 'source-link.png')
    const canonicalPath = path.join(PROJECT_ROOT, 'assets', 'source.png')
    const resolveReadableFile = vi.fn(() => canonicalPath)
    const original = request({
      inputFiles: [
        {
          type: 'image',
          role: 'reference',
          path: selectedPath,
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
        },
      ],
    })

    const authorized = authorizeCanvasMediaRequestPaths(
      original,
      SENDER,
      dependencies({ resolveReadableFile }),
    )

    expect(resolveReadableFile).toHaveBeenCalledWith(SENDER, selectedPath, PROJECT_ROOT)
    expect(authorized.inputFiles).toEqual([
      {
        ...original.inputFiles?.[0],
        path: canonicalPath,
      },
    ])
    expect(original.inputFiles?.[0]?.path).toBe(selectedPath)
  })

  it('validates a safe-file URL through the same file authority and preserves the URL', () => {
    const selectedPath = path.join(PROJECT_ROOT, 'assets', 'frame.png')
    const url = safeFileUrl(selectedPath)
    const resolveReadableFile = vi.fn(() => selectedPath)

    const authorized = authorizeCanvasMediaRequestPaths(
      request({ inputFiles: [{ type: 'image', url }] }),
      SENDER,
      dependencies({ resolveReadableFile }),
    )

    expect(resolveReadableFile).toHaveBeenCalledWith(SENDER, selectedPath, PROJECT_ROOT)
    expect(authorized.inputFiles?.[0]?.url).toBe(url)
  })

  it.each([
    'https://cdn.example.com/frame.png',
    'http://localhost:8080/reference.jpg',
    'data:image/png;base64,AAAA',
  ])('allows a remote or inline URL without local file access: %s', (url) => {
    const resolveReadableFile = vi.fn(() => path.join(PROJECT_ROOT, 'unused'))

    const authorized = authorizeCanvasMediaRequestPaths(
      request({ inputFiles: [{ type: 'image', url }] }),
      SENDER,
      dependencies({ resolveReadableFile }),
    )

    expect(authorized.inputFiles?.[0]?.url).toBe(url)
    expect(resolveReadableFile).not.toHaveBeenCalled()
  })

  it.each([
    path.join(PROJECT_ROOT, 'assets', 'raw-local.png'),
    'file:///etc/passwd',
    'blob:https://example.com/id',
    'ftp://example.com/file.png',
    'safe-file://x/not-valid-base64-path',
  ])('rejects an unapproved URL form: %s', (url) => {
    expect(() =>
      authorizeCanvasMediaRequestPaths(
        request({ inputFiles: [{ type: 'image', url }] }),
        SENDER,
        dependencies(),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
  })

  it('normalizes unauthorized path failures to SparkError PERMISSION_DENIED', () => {
    const unauthorizedPath = path.resolve('private', 'secret.png')
    const deps = dependencies({
      resolveReadableFile: () => {
        throw new Error('not granted')
      },
    })

    try {
      authorizeCanvasMediaRequestPaths(
        request({ inputFiles: [{ type: 'image', path: unauthorizedPath }] }),
        SENDER,
        deps,
      )
      expect.unreachable('expected unauthorized media path to fail closed')
    } catch (error) {
      expect(error).toBeInstanceOf(SparkError)
      expect(error).toMatchObject({ code: 'PERMISSION_DENIED' })
    }
  })
})
