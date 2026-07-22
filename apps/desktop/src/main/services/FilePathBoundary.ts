import { lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'

/** Resolve existing path components so symlinks cannot cross an allowlisted root. */
function canonicalizePath(input: string): string | null {
  if (!isAbsolute(input)) return null

  let cursor = resolve(input)
  const missingSegments: string[] = []
  while (true) {
    try {
      lstatSync(cursor)
      break
    } catch {
      const parent = dirname(cursor)
      if (parent === cursor) return null
      missingSegments.unshift(basename(cursor))
      cursor = parent
    }
  }

  try {
    return resolve(realpathSync.native(cursor), ...missingSegments)
  } catch {
    return null
  }
}

export function isCanonicalPathSameOrChild(targetPath: string, rootPath: string): boolean {
  const target = canonicalizePath(targetPath)
  const root = canonicalizePath(rootPath)
  if (target == null || root == null) return false

  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
