import { realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { isCanonicalPathSameOrChild } from './FilePathBoundary.js'

export const MAX_CANVAS_TEXT_FILE_BYTES = 2 * 1024 * 1024

export interface CanvasFileAccessGrantSender {
  once(event: 'destroyed', listener: () => void): unknown
}

type GrantKind = 'file' | 'directory'

export interface CanvasReadablePath {
  path: string
  kind: GrantKind
}

export class CanvasFileAccessGrantService {
  private readonly grantsBySender = new WeakMap<
    CanvasFileAccessGrantSender,
    Map<string, GrantKind>
  >()

  private readonly observedSenders = new WeakSet<CanvasFileAccessGrantSender>()

  grantSelectedPaths(sender: CanvasFileAccessGrantSender, selectedPaths: readonly string[]): void {
    const grants = selectedPaths.map((selectedPath) => {
      if (!isAbsolute(selectedPath)) {
        throw new Error('Selected path must be absolute')
      }

      let canonicalPath: string
      try {
        canonicalPath = realpathSync.native(selectedPath)
      } catch {
        throw new Error('Selected path must exist')
      }

      const stats = statSync(canonicalPath)
      if (stats.isFile()) return [canonicalPath, 'file'] as const
      if (stats.isDirectory()) return [canonicalPath, 'directory'] as const
      throw new Error('Selected path must be a regular file or directory')
    })

    if (grants.length === 0) return

    let senderGrants = this.grantsBySender.get(sender)
    if (senderGrants == null) {
      senderGrants = new Map()
      this.grantsBySender.set(sender, senderGrants)
    }
    for (const [canonicalPath, kind] of grants) senderGrants.set(canonicalPath, kind)

    if (!this.observedSenders.has(sender)) {
      this.observedSenders.add(sender)
      sender.once('destroyed', () => {
        this.grantsBySender.delete(sender)
        this.observedSenders.delete(sender)
      })
    }
  }

  isPathAllowed(
    sender: CanvasFileAccessGrantSender,
    targetPath: string,
    projectRootPath?: string,
  ): boolean {
    if (
      projectRootPath != null &&
      isCanonicalPathSameOrChild(targetPath, projectRootPath)
    ) {
      return true
    }

    const senderGrants = this.grantsBySender.get(sender)
    if (senderGrants == null) return false

    for (const [grantedPath, kind] of senderGrants) {
      if (kind === 'directory' && isCanonicalPathSameOrChild(targetPath, grantedPath)) {
        return true
      }
      if (
        kind === 'file' &&
        isCanonicalPathSameOrChild(targetPath, grantedPath) &&
        isCanonicalPathSameOrChild(grantedPath, targetPath)
      ) {
        return true
      }
    }
    return false
  }

  resolveReadablePath(
    sender: CanvasFileAccessGrantSender,
    targetPath: string,
    projectRootPath?: string,
  ): CanvasReadablePath {
    let canonicalPath: string
    try {
      canonicalPath = realpathSync.native(targetPath)
    } catch {
      throw new Error('Path must resolve to an existing regular file or directory')
    }

    if (!this.isPathAllowed(sender, canonicalPath, projectRootPath)) {
      throw new Error('File path is not allowed')
    }

    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(canonicalPath)
    } catch {
      throw new Error('Path must resolve to an existing regular file or directory')
    }
    if (stats.isFile()) return { path: canonicalPath, kind: 'file' }
    if (stats.isDirectory()) return { path: canonicalPath, kind: 'directory' }
    throw new Error('Path must resolve to an existing regular file or directory')
  }

  resolveReadableTextFile(
    sender: CanvasFileAccessGrantSender,
    targetPath: string,
    projectRootPath?: string,
  ): string {
    const resolved = this.resolveReadablePath(sender, targetPath, projectRootPath)
    if (resolved.kind !== 'file') {
      throw new Error('Path must resolve to an existing regular file')
    }
    const stats = statSync(resolved.path)
    if (stats.size > MAX_CANVAS_TEXT_FILE_BYTES) {
      throw new Error('Text file exceeds the 2 MiB limit')
    }

    return resolved.path
  }
}
