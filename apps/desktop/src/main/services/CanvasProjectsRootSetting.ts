import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'

import { SparkError } from '@spark/shared'

export const CANVAS_PROJECTS_ROOT_GRANT_VERSION = 2

type SettingsRecord = Record<string, unknown>

function asSettingsRecord(value: unknown): SettingsRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as SettingsRecord)
    : null
}

function canonicalDirectory(candidate: string): string | null {
  if (!path.isAbsolute(candidate)) return null
  try {
    const canonical = realpathSync.native(candidate)
    return statSync(canonical).isDirectory() ? canonical : null
  } catch {
    return null
  }
}

/**
 * Validate the Canvas projects root at the settings write boundary.
 * The resolver must be backed by a native directory grant for the original sender.
 */
export function authorizeCanvasProjectsRootSetting(
  sender: unknown,
  value: unknown,
  resolveGrantedDirectory: (sender: unknown, requestedPath: string) => string,
): SettingsRecord {
  const current = asSettingsRecord(value)
  if (current == null) {
    throw new SparkError('VALIDATION_FAILED', 'Canvas 设置格式无效。')
  }

  const next = { ...current }
  const requested = current.projectsRootPath
  if (requested == null || (typeof requested === 'string' && requested.trim().length === 0)) {
    delete next.projectsRootPath
    delete next.projectsRootPathGrantVersion
    return next
  }
  if (typeof requested !== 'string') {
    throw new SparkError('VALIDATION_FAILED', 'Canvas 项目根目录格式无效。')
  }

  let grantedPath: string
  try {
    grantedPath = resolveGrantedDirectory(sender, requested)
  } catch {
    throw new SparkError('PERMISSION_DENIED', '当前窗口没有该 Canvas 项目目录的原生授权。')
  }
  const canonical = canonicalDirectory(grantedPath)
  if (canonical == null) {
    throw new SparkError('VALIDATION_FAILED', 'Canvas 项目根路径必须是已存在的目录。')
  }

  next.projectsRootPath = canonical
  next.projectsRootPathGrantVersion = CANVAS_PROJECTS_ROOT_GRANT_VERSION
  return next
}

/** Read only roots that were canonicalized by the v2 native-grant write policy. */
export function readTrustedCanvasProjectsRoot(value: unknown): string | null {
  const current = asSettingsRecord(value)
  if (
    current?.projectsRootPathGrantVersion !== CANVAS_PROJECTS_ROOT_GRANT_VERSION ||
    typeof current.projectsRootPath !== 'string'
  ) {
    return null
  }
  return canonicalDirectory(current.projectsRootPath)
}
