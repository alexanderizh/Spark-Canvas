import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

function migrateAssetsHandlerBody(): string {
  const start = source.indexOf("typedIpcHandle('canvas:project:migrate-assets'")
  const end = source.indexOf("typedIpcHandle('canvas:project:cleanup-orphans'", start)
  if (start < 0 || end < 0) throw new Error('Unable to isolate canvas:project:migrate-assets')
  return source.slice(start, end)
}

describe('Canvas project asset migration boundary', () => {
  it('fails the migration when a referenced local asset cannot be copied', () => {
    const handler = migrateAssetsHandlerBody()

    expect(handler).not.toContain('skippedAssets += 1\n        return null')
    expect(handler).toContain('Canvas asset migration failed')
  })

  it('binds every migration source to the requesting sender grant or target project root', () => {
    const handler = migrateAssetsHandlerBody()

    expect(handler).toContain('requireCanvasProjectManagerSender(event.sender')
    expect(handler).toMatch(
      /sourceFilePath[\s\S]{0,800}resolveReadableFile\([\s\S]{0,300}event\.sender/,
    )
    expect(handler).toMatch(
      /const resolvedSource = canvasFileAccess\.resolveReadableFile\([\s\S]{0,300}canonicalTargetRoot/,
    )
    expect(handler).not.toContain('importSourceRoot ?? canonicalTargetRoot')
    expect(handler).toContain('rewriteCanvasSnapshotRootPaths(')
  })
})
