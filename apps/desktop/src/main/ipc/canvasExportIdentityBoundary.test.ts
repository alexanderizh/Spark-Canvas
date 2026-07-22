import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const packageWriterSource = readFileSync(
  join(__dirname, '../services/CanvasProjectPackageFiles.ts'),
  'utf8',
)

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) throw new Error(`Unable to isolate ${startMarker}`)
  return source.slice(start, end)
}

describe('Canvas export identity boundary', () => {
  it('writes new project packages with the spark-canvas machine identity', () => {
    expect(packageWriterSource).toContain("app: 'spark-canvas'")
    expect(packageWriterSource).not.toContain("app: 'Spark-Agent'")
  })

  it('uses a Spark Canvas default filename for provider exports', () => {
    const handler = sourceBetween(
      "typedIpcHandle('provider:export-to-file'",
      "typedIpcHandle('provider:import-from-file'",
    )

    expect(handler).toContain('`spark-canvas-providers-${datePart}.json`')
    expect(handler).not.toContain('spark-agent-providers')
  })

  it('delegates directory exports to the atomic portable v3 package service', () => {
    const handler = sourceBetween(
      "typedIpcHandle('canvas:project:export-package'",
      "typedIpcHandle('canvas:project:migrate-assets'",
    )

    expect(handler).toContain('await exportCanvasProjectDirectoryPackage(')
    expect(handler).not.toContain('await fs.cp(')
    expect(handler).not.toContain('rewriteCanvasSnapshotRootPaths(')
  })
})
