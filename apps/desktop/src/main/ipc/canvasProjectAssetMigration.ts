import path from 'node:path'

export function rewriteCanvasSnapshotRootPaths(
  value: unknown,
  fromRoot: string,
  toRoot: string,
  decodeSafeFileUrl: (value: string | undefined) => string | null,
  toSafeFileUrl: (filePath: string) => string,
): unknown {
  if (typeof value === 'string') {
    const decoded = decodeSafeFileUrl(value)
    if (decoded && path.resolve(decoded).startsWith(fromRoot + path.sep)) {
      return toSafeFileUrl(path.join(toRoot, path.relative(fromRoot, path.resolve(decoded))))
    }
    if (path.isAbsolute(value) && path.resolve(value).startsWith(fromRoot + path.sep)) {
      return path.join(toRoot, path.relative(fromRoot, path.resolve(value)))
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      rewriteCanvasSnapshotRootPaths(
        item,
        fromRoot,
        toRoot,
        decodeSafeFileUrl,
        toSafeFileUrl,
      ),
    )
  }
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      rewriteCanvasSnapshotRootPaths(
        child,
        fromRoot,
        toRoot,
        decodeSafeFileUrl,
        toSafeFileUrl,
      ),
    ]),
  )
}
