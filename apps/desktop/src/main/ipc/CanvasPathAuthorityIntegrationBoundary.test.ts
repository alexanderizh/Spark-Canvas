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

describe('Canvas path authority integration boundary', () => {
  it('delegates native selection and text reads to the sender-bound file controller', () => {
    expect(source).toContain('registerCanvasFileAccessIpc({')
    expect(source).not.toContain("typedIpcHandle('dialog:open-directory'")
    expect(source).not.toContain("typedIpcHandle('dialog:open-file'")
    expect(source).not.toContain("typedIpcHandle('file:stat-kind'")
    expect(source).not.toContain("typedIpcHandle('file:read-text'")
  })

  it('coordinates snapshot and directory roots through DB authority plus sender grants', () => {
    expect(handlerBody('canvas:snapshot:save', 'canvas:snapshot:load')).toContain(
      'coordinateCanvasProjectDirectory(',
    )
    expect(handlerBody('canvas:project:ensure-directory', 'canvas:asset:write-data-url')).toContain(
      'coordinateCanvasProjectDirectory(',
    )
    expect(source).toContain('rootPath: row?.root_path ?? rootPath ?? null')
  })

  it('validates Canvas root settings and Canvas Agent attachments with the same grants', () => {
    expect(handlerBody('settings:set', 'settings:get-category')).toContain(
      'authorizeCanvasProjectsRootSetting(',
    )
    expect(source).toContain('validateAttachments: (sender, projectId, attachments) =>')
    expect(source).toContain('canvasFileAccess.validateAttachments(')
  })

  it('canonicalizes asset-copy sources instead of trusting renderer source paths', () => {
    const handler = handlerBody('canvas:asset:copy-to-project', 'canvas:asset:download')
    expect(handler).toContain('canvasFileAccess.resolveReadableFile(')
    expect(handler).not.toContain('sourceUrl: req.sourceUrl')
  })
})
