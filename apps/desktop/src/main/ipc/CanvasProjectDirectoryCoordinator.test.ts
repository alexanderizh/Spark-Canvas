/**
 * CanvasProjectDirectoryCoordinator —— canvas 项目目录准备的可测试协调器。
 *
 * 背景漏洞：canvas:snapshot:save / canvas:project:ensure-directory 直接把 renderer 传来的
 * rootPath / parentDirectory 透传给 ensureCanvasProjectDirectory，可被用于把已存在项目静默迁移，
 * 或让新项目逃逸出受控的 projects 根。本协调器封装 {@link resolveCanvasProjectRoot} 的权威判定：
 * 只有拿到已授权的值才交给注入的 ensureDirectory；被拒绝时统一抛 PERMISSION_DENIED。
 *
 * 覆盖：已存在项目 root 篡改、parent 注入、已存在项目沿用 DB 根、新项目默认、默认根内、
 * granted 外部 root/parent、未授权外部拒绝。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isCanonicalPathSameOrChild } from '../services/FilePathBoundary.js'
import {
  coordinateCanvasProjectDirectory,
  type CanvasProjectDirectoryCoordinatorDependencies,
} from './CanvasProjectDirectoryCoordinator.js'

let workDir: string
let defaultRoot: string
let grantedRoot: string
let outsideRoot: string

interface EnsureResult {
  rootPath: string
  created: boolean
}

const SENDER = { id: 'window-1' }

function makeDeps(
  overrides: Partial<CanvasProjectDirectoryCoordinatorDependencies<EnsureResult>> = {},
): CanvasProjectDirectoryCoordinatorDependencies<EnsureResult> {
  const ensureDirectory = vi.fn(async (input) => ({
    rootPath: input.rootPath ?? path.join(input.parentDirectory ?? defaultRoot, `resolved-${input.projectId}`),
    created: true,
  }))
  return {
    findProject: () => null,
    defaultProjectsRoot: () => defaultRoot,
    // 真实 grant：调用方自定义，这里用 symlink-safe 的 canonical 判定模拟一条授权目录。
    isGranted: (_sender, candidate) => isCanonicalPathSameOrChild(candidate, grantedRoot),
    ensureDirectory,
    ...overrides,
  }
}

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'canvas-dir-coordinator-'))
  defaultRoot = path.join(workDir, 'canvas-projects')
  grantedRoot = path.join(workDir, 'granted-space')
  outsideRoot = path.join(workDir, 'outside-space')
  mkdirSync(defaultRoot, { recursive: true })
  mkdirSync(grantedRoot, { recursive: true })
  mkdirSync(outsideRoot, { recursive: true })
})

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('coordinateCanvasProjectDirectory — existing project', () => {
  it('uses the DB root when renderer sends nothing', async () => {
    const existing = path.join(defaultRoot, 'proj-abc')
    mkdirSync(existing, { recursive: true })
    const ensureDirectory = vi.fn(async () => ({ rootPath: existing, created: false }))
    const deps = makeDeps({
      findProject: () => ({ root_path: existing }),
      ensureDirectory,
    })

    const result = await coordinateCanvasProjectDirectory(
      { sender: SENDER, projectId: 'proj-abc' },
      deps,
    )

    expect(result).toEqual({ rootPath: existing, created: false })
    expect(ensureDirectory).toHaveBeenCalledTimes(1)
    expect(ensureDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-abc', rootPath: existing }),
    )
  })

  it('rejects a renderer rootPath that differs from the existing root (no silent migration)', async () => {
    const existing = path.join(defaultRoot, 'proj-abc')
    mkdirSync(existing, { recursive: true })
    const ensureDirectory = vi.fn(async () => ({ rootPath: existing, created: false }))
    const deps = makeDeps({
      findProject: () => ({ root_path: existing }),
      ensureDirectory,
    })

    await expect(
      coordinateCanvasProjectDirectory(
        {
          sender: SENDER,
          projectId: 'proj-abc',
          requestedRootPath: path.join(outsideRoot, 'hijack'),
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(ensureDirectory).not.toHaveBeenCalled()
  })

  it('rejects an injected parentDirectory on an existing project', async () => {
    const existing = path.join(defaultRoot, 'proj-abc')
    mkdirSync(existing, { recursive: true })
    const ensureDirectory = vi.fn(async () => ({ rootPath: existing, created: false }))
    const deps = makeDeps({
      findProject: () => ({ root_path: existing }),
      ensureDirectory,
    })

    await expect(
      coordinateCanvasProjectDirectory(
        {
          sender: SENDER,
          projectId: 'proj-abc',
          requestedRootPath: existing,
          requestedParentDirectory: outsideRoot,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(ensureDirectory).not.toHaveBeenCalled()
  })
})

describe('coordinateCanvasProjectDirectory — new project', () => {
  it('falls back to the default root when renderer sends no path', async () => {
    const ensureDirectory = vi.fn(async () => ({ rootPath: path.join(defaultRoot, 'new'), created: true }))
    const deps = makeDeps({ ensureDirectory })

    const result = await coordinateCanvasProjectDirectory(
      { sender: SENDER, projectId: 'new', title: 'Fresh' },
      deps,
    )

    expect(result.created).toBe(true)
    expect(ensureDirectory).toHaveBeenCalledWith({
      projectId: 'new',
      title: 'Fresh',
    })
  })

  it('allows a requested rootPath inside the default root', async () => {
    const requested = path.join(defaultRoot, 'new-proj')
    const deps = makeDeps()

    await coordinateCanvasProjectDirectory(
      { sender: SENDER, projectId: 'new-proj', requestedRootPath: requested },
      deps,
    )

    expect(deps.ensureDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'new-proj', rootPath: path.resolve(requested) }),
    )
  })

  it('allows a granted external rootPath', async () => {
    const requested = path.join(grantedRoot, 'ext-proj')
    const deps = makeDeps()

    await coordinateCanvasProjectDirectory(
      { sender: SENDER, projectId: 'ext', requestedRootPath: requested },
      deps,
    )

    expect(deps.ensureDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: path.resolve(requested) }),
    )
  })

  it('allows a granted external parentDirectory', async () => {
    const deps = makeDeps()

    await coordinateCanvasProjectDirectory(
      { sender: SENDER, projectId: 'ext', requestedParentDirectory: grantedRoot },
      deps,
    )

    expect(deps.ensureDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ parentDirectory: path.resolve(grantedRoot) }),
    )
  })

  it('rejects an ungranted external rootPath and does not touch the filesystem', async () => {
    const requested = path.join(outsideRoot, 'ext-proj')
    const deps = makeDeps()

    await expect(
      coordinateCanvasProjectDirectory(
        { sender: SENDER, projectId: 'ext', requestedRootPath: requested },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(deps.ensureDirectory).not.toHaveBeenCalled()
  })

  it('passes the sender through to the injected grant check', async () => {
    const isGranted = vi.fn(() => true)
    const deps = makeDeps({ isGranted })

    await coordinateCanvasProjectDirectory(
      { sender: SENDER, projectId: 'ext', requestedParentDirectory: outsideRoot },
      deps,
    )

    expect(isGranted).toHaveBeenCalledWith(SENDER, path.resolve(outsideRoot))
  })
})
