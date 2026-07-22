import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

function handlerBody(channel: string, nextChannel: string): string {
  const start = source.indexOf(`typedIpcHandle('${channel}'`)
  const end = source.indexOf(`typedIpcHandle('${nextChannel}'`, start)
  if (start < 0 || end < 0) throw new Error(`Unable to isolate ${channel}`)
  return source.slice(start, end)
}

describe('Canvas project package IPC boundary', () => {
  it('exports from the DB root into a sender-granted directory', () => {
    const handler = handlerBody(
      'canvas:project:export-package',
      'canvas:project:import-package',
    )
    expect(handler).toContain('canvasProjectPackageAuthority.authorizeExport(')
    expect(handler).toContain('event.sender as CanvasPackageAuthoritySender')
    expect(handler).toContain('sourceRootPath: authorized.sourceRootPath')
    expect(handler).toContain('authorized.targetParentPath')
    expect(handler).not.toContain('req.projectRootPath?.trim()')
  })

  it('validates and imports sender-granted v3 directories', () => {
    const handler = handlerBody(
      'canvas:project:import-package',
      'canvas:project:migrate-assets',
    )
    expect(handler).toContain('CanvasProjectImportPackageRequestSchema.parse(req)')
    expect(handler).toContain('canvasProjectPackageAuthority.authorizeImport(')
    expect(handler).toContain('event.sender as CanvasPackageAuthoritySender')
    expect(handler).toContain('sourceRootPath: authorized.sourceRootPath')
    expect(handler).toContain('targetParentPath: authorized.targetParentPath')
  })
})
