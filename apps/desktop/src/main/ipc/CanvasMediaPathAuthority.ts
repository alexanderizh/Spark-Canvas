import path from 'node:path'

import type {
  CanvasMediaTaskCreateRequest,
  CanvasMediaTaskInputFile,
} from '@spark/protocol'
import { SparkError } from '@spark/shared'

export interface CanvasMediaProjectRecord {
  status: string
  root_path: string | null
}

export interface CanvasMediaPathAuthorityDependencies {
  findProject(projectId: string): CanvasMediaProjectRecord | null
  isActiveProject(sender: unknown, projectId: string): boolean
  resolveReadableFile(sender: unknown, filePath: string, trustedProjectRoot: string): string
}

export type AuthorizedCanvasMediaTaskCreateRequest = CanvasMediaTaskCreateRequest & {
  projectId: string
  outputDir: string
}

function permissionDenied(message: string, context: Record<string, unknown>): SparkError {
  return new SparkError('PERMISSION_DENIED', message, context)
}

/** Mirrors the safe-file encoder/decoder contract used by SafeFileProtocol. */
function decodeSafeFileUrl(url: string): string | null {
  if (!url.startsWith('safe-file://')) return null
  try {
    const rest = url.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return null
    const encoded = rest.slice(slashIndex + 1)
    if (!encoded) return null
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8')
    return decoded && path.isAbsolute(decoded) ? decoded : null
  } catch {
    return null
  }
}

function authorizeReadableFile(
  sender: unknown,
  filePath: string,
  projectId: string,
  trustedProjectRoot: string,
  dependencies: CanvasMediaPathAuthorityDependencies,
): string {
  try {
    const resolved = dependencies.resolveReadableFile(sender, filePath, trustedProjectRoot)
    if (!path.isAbsolute(resolved)) throw new Error('Resolved media path must be absolute')
    return resolved
  } catch {
    throw permissionDenied('当前窗口无权读取该媒体文件。', { projectId, path: filePath })
  }
}

function authorizeInputFile(
  input: CanvasMediaTaskInputFile,
  sender: unknown,
  projectId: string,
  trustedProjectRoot: string,
  dependencies: CanvasMediaPathAuthorityDependencies,
): CanvasMediaTaskInputFile {
  const authorized: CanvasMediaTaskInputFile = { ...input }

  if (input.path !== undefined) {
    authorized.path = authorizeReadableFile(
      sender,
      input.path,
      projectId,
      trustedProjectRoot,
      dependencies,
    )
  }

  if (input.url !== undefined) {
    const localPath = decodeSafeFileUrl(input.url)
    if (localPath !== null) {
      authorizeReadableFile(sender, localPath, projectId, trustedProjectRoot, dependencies)
    } else {
      let protocol: string | null = null
      try {
        protocol = new URL(input.url).protocol.toLowerCase()
      } catch {
        // A local path or malformed URL must not cross the media boundary.
      }
      if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'data:') {
        throw permissionDenied('媒体 URL 必须是 http(s)、data 或已授权的 safe-file 地址。', {
          projectId,
          url: input.url,
        })
      }
    }
  }

  return authorized
}

/**
 * Converts a renderer media request into a project-bound request safe for the runtime.
 * The DB root is authoritative; renderer paths are never used without sender-bound validation.
 */
export function authorizeCanvasMediaRequestPaths(
  request: CanvasMediaTaskCreateRequest,
  sender: unknown,
  dependencies: CanvasMediaPathAuthorityDependencies,
): AuthorizedCanvasMediaTaskCreateRequest {
  const projectId = request.projectId?.trim()
  if (!projectId) {
    throw new SparkError('VALIDATION_FAILED', 'Canvas media request requires projectId.')
  }

  if (!dependencies.isActiveProject(sender, projectId)) {
    throw permissionDenied('当前窗口无权为该画布项目创建媒体任务。', { projectId })
  }

  const project = dependencies.findProject(projectId)
  if (project === null) {
    throw new SparkError('NOT_FOUND', `Canvas project not found: ${projectId}`, { projectId })
  }
  if (project.status !== 'active') {
    throw permissionDenied('当前画布项目不是 active 状态。', { projectId })
  }

  const rootPath = project.root_path?.trim()
  if (!rootPath || !path.isAbsolute(rootPath)) {
    throw new SparkError('WORKSPACE_NOT_FOUND', `Canvas project has no valid directory: ${projectId}`, {
      projectId,
    })
  }

  const trustedProjectRoot = path.resolve(rootPath)
  const outputDir = path.join(trustedProjectRoot, 'assets')
  if (
    request.outputDir !== undefined &&
    (!path.isAbsolute(request.outputDir.trim()) || path.resolve(request.outputDir.trim()) !== outputDir)
  ) {
    throw permissionDenied('媒体输出目录必须位于当前画布项目的 assets 目录。', {
      projectId,
      outputDir: request.outputDir,
    })
  }

  const inputFiles = request.inputFiles?.map((input) =>
    authorizeInputFile(input, sender, projectId, trustedProjectRoot, dependencies),
  )

  return {
    ...request,
    projectId,
    ...(inputFiles === undefined ? {} : { inputFiles }),
    outputDir,
  }
}
