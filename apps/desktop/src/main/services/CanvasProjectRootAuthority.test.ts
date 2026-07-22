/**
 * CanvasProjectRootAuthority —— canvas 项目根目录的权威边界（纯函数）。
 *
 * 背景漏洞：canvas:snapshot:save / canvas:project:ensure-directory 直接信任 renderer
 * 传来的 rootPath / parentDirectory，可被用于把已存在项目静默迁移到任意目录，或在新项目上
 * 逃逸出受控的 projects 根。此处集中做「权威根」判定，调用方只能拿到已授权的值再传给
 * ensureCanvasProjectDirectory。
 *
 * 覆盖：existing authoritative、existing mismatch root、existing injected parent、
 * 新项目默认、新项目默认根内、granted 外部 root、granted parent、未授权外部、
 * prefix sibling、symlink escape（平台允许时）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isCanonicalPathSameOrChild } from './FilePathBoundary.js'
import { resolveCanvasProjectRoot } from './CanvasProjectRootAuthority.js'

let workDir: string
let defaultRoot: string
let grantedRoot: string
let outsideRoot: string

/** 真实的 grant：调用方自定义，这里用 symlink-safe 的 canonical 判定模拟一条授权目录。 */
const isGranted = (p: string): boolean => isCanonicalPathSameOrChild(p, grantedRoot)

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'canvas-root-authority-'))
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

describe('resolveCanvasProjectRoot — existing project (DB root is authoritative)', () => {
  it('always uses the DB existing root when renderer sends nothing', () => {
    const existing = path.join(defaultRoot, 'proj-abc')
    mkdirSync(existing, { recursive: true })
    const result = resolveCanvasProjectRoot({
      existingRootPath: existing,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.source).toBe('existing')
      expect(result.rootPath).toBe(existing)
      expect(result.parentDirectory).toBeUndefined()
    }
  })

  it('accepts a renderer rootPath equal to the existing root', () => {
    const existing = path.join(defaultRoot, 'proj-abc')
    mkdirSync(existing, { recursive: true })
    const result = resolveCanvasProjectRoot({
      existingRootPath: existing,
      requestedRootPath: existing,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.rootPath).toBe(existing)
  })

  it('rejects a renderer rootPath that differs from the existing root (no silent migration)', () => {
    const existing = path.join(defaultRoot, 'proj-abc')
    mkdirSync(existing, { recursive: true })
    const result = resolveCanvasProjectRoot({
      existingRootPath: existing,
      requestedRootPath: path.join(outsideRoot, 'hijack'),
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects an injected parentDirectory on an existing project', () => {
    const existing = path.join(defaultRoot, 'proj-abc')
    mkdirSync(existing, { recursive: true })
    const result = resolveCanvasProjectRoot({
      existingRootPath: existing,
      requestedParentDirectory: outsideRoot,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(false)
  })
})

describe('resolveCanvasProjectRoot — new project', () => {
  it('falls back to the default projects root when renderer sends no path', () => {
    const result = resolveCanvasProjectRoot({
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.source).toBe('default')
      expect(result.rootPath).toBeUndefined()
      expect(result.parentDirectory).toBeUndefined()
    }
  })

  it('allows a requested rootPath inside the default projects root', () => {
    const requested = path.join(defaultRoot, 'new-proj')
    const result = resolveCanvasProjectRoot({
      requestedRootPath: requested,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.source).toBe('requested-root')
      expect(result.rootPath).toBe(path.resolve(requested))
    }
  })

  it('allows a granted external rootPath', () => {
    const requested = path.join(grantedRoot, 'ext-proj')
    const result = resolveCanvasProjectRoot({
      requestedRootPath: requested,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.source).toBe('requested-root')
      expect(result.rootPath).toBe(path.resolve(requested))
    }
  })

  it('allows a granted external parentDirectory', () => {
    const result = resolveCanvasProjectRoot({
      requestedParentDirectory: grantedRoot,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.source).toBe('requested-parent')
      expect(result.parentDirectory).toBe(path.resolve(grantedRoot))
      expect(result.rootPath).toBeUndefined()
    }
  })

  it('rejects an ungranted external rootPath', () => {
    const requested = path.join(outsideRoot, 'ext-proj')
    const result = resolveCanvasProjectRoot({
      requestedRootPath: requested,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a prefix-sibling of the default root (canvas-projects-evil)', () => {
    const sibling = `${defaultRoot}-evil`
    mkdirSync(sibling, { recursive: true })
    const requested = path.join(sibling, 'proj')
    const result = resolveCanvasProjectRoot({
      requestedRootPath: requested,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a symlink inside the default root that escapes outside (canonical-safe)', () => {
    const link = path.join(defaultRoot, 'escape-link')
    try {
      symlinkSync(outsideRoot, link, 'dir')
    } catch {
      // 平台不允许创建 symlink（如无权限的 Windows），跳过该断言。
      return
    }
    const requested = path.join(link, 'proj')
    const result = resolveCanvasProjectRoot({
      requestedRootPath: requested,
      defaultProjectsRoot: defaultRoot,
      isGranted,
    })
    expect(result.ok).toBe(false)
  })
})
