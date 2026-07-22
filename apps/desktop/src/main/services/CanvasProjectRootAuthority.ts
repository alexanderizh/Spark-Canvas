import path from 'node:path'
import { isCanonicalPathSameOrChild } from './FilePathBoundary.js'

/**
 * canvas 项目根目录的权威边界（纯函数，无副作用、不碰磁盘写入）。
 *
 * 背景漏洞：canvas:snapshot:save / canvas:project:ensure-directory 直接信任 renderer 传来的
 * rootPath / parentDirectory，可被用来把已存在项目静默迁移到任意目录，或让新项目逃逸出受控的
 * projects 根。此处集中判定「权威根」，让调用方只能拿到已授权的值再传给
 * ensureCanvasProjectDirectory，避免把未授权的 renderer 字符串继续透传。
 *
 * 复用 {@link isCanonicalPathSameOrChild} 的 canonical / symlink-safe 判定，不做脆弱的 startsWith。
 */
export interface CanvasProjectRootAuthorityInput {
  /** DB 中已存在项目的 root_path（若为空/缺省则视为新项目）。 */
  existingRootPath?: string | null
  /** renderer 请求的精确项目根（对应 ensureCanvasProjectDirectory 的 rootPath）。 */
  requestedRootPath?: string | null
  /** renderer 请求的父目录容器（对应 ensureCanvasProjectDirectory 的 parentDirectory）。 */
  requestedParentDirectory?: string | null
  /** 受控的默认 projects 根；位于其内的请求路径无需额外授权。 */
  defaultProjectsRoot: string
  /** 由调用方注入的授权判定；对某条外部路径返回 true 表示用户已显式授权。 */
  isGranted: (candidatePath: string) => boolean
}

/**
 * 授权结果。`ok: true` 时，调用方应把 `rootPath` / `parentDirectory` 原样传给
 * ensureCanvasProjectDirectory —— 两者都缺省表示走默认根。绝不要再把原始 renderer 字符串透传。
 */
export type CanvasProjectRootAuthorityResult =
  | {
      ok: true
      /**
       * existing = 沿用 DB 权威根；default = 走默认根；
       * requested-root = 授权后的精确根；requested-parent = 授权后的父目录容器。
       */
      source: 'existing' | 'default' | 'requested-root' | 'requested-parent'
      /** 传给 ensureCanvasProjectDirectory 的 rootPath；缺省表示不传。 */
      rootPath?: string
      /** 传给 ensureCanvasProjectDirectory 的 parentDirectory；缺省表示不传。 */
      parentDirectory?: string
    }
  | { ok: false; reason: string }

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** symlink-safe 的 canonical 相等：互为「同或子」即为同一真实路径。 */
function isCanonicalSamePath(a: string, b: string): boolean {
  if (path.resolve(a) === path.resolve(b)) return true
  return isCanonicalPathSameOrChild(a, b) && isCanonicalPathSameOrChild(b, a)
}

/** canonical 后位于默认根内，或调用方已显式授权。 */
function isAuthorizedLocation(candidate: string, input: CanvasProjectRootAuthorityInput): boolean {
  const resolved = path.resolve(candidate)
  return isCanonicalPathSameOrChild(resolved, input.defaultProjectsRoot) || input.isGranted(resolved)
}

export function resolveCanvasProjectRoot(
  input: CanvasProjectRootAuthorityInput,
): CanvasProjectRootAuthorityResult {
  const existing = normalize(input.existingRootPath)
  const requestedRoot = normalize(input.requestedRootPath)
  const requestedParent = normalize(input.requestedParentDirectory)

  // 规则 1：已存在项目的 DB 根永远权威。renderer 同值 / 空值可接受，任何不同值都拒绝，不做静默迁移。
  if (existing) {
    if (requestedRoot && !isCanonicalSamePath(requestedRoot, existing)) {
      return { ok: false, reason: 'existing-root-mismatch' }
    }
    const existingParent = path.dirname(path.resolve(existing))
    if (requestedParent && !isCanonicalSamePath(requestedParent, existingParent)) {
      return { ok: false, reason: 'existing-parent-injection' }
    }
    return { ok: true, source: 'existing', rootPath: existing }
  }

  // 规则 2：新项目且 renderer 未指定路径 —— 走默认根。
  if (!requestedRoot && !requestedParent) {
    return { ok: true, source: 'default' }
  }

  // 规则 3：新项目的 requestedRootPath / parentDirectory 必须位于默认根内或被授权。
  // rootPath 语义为「精确项目目录」，优先于 parentDirectory（容器）。
  if (requestedRoot) {
    if (!isAuthorizedLocation(requestedRoot, input)) {
      return { ok: false, reason: 'requested-root-unauthorized' }
    }
    return { ok: true, source: 'requested-root', rootPath: path.resolve(requestedRoot) }
  }

  if (!isAuthorizedLocation(requestedParent!, input)) {
    return { ok: false, reason: 'requested-parent-unauthorized' }
  }
  return { ok: true, source: 'requested-parent', parentDirectory: path.resolve(requestedParent!) }
}
