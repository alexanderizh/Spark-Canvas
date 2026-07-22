import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

function saveHandlerBody(): string {
  const start = source.indexOf("typedIpcHandle('canvas:snapshot:save'")
  const end = source.indexOf("typedIpcHandle('canvas:snapshot:load'", start)
  if (start < 0 || end < 0) throw new Error('Unable to isolate canvas:snapshot:save')
  return source.slice(start, end)
}

describe('Canvas snapshot persistence boundary', () => {
  it('fails before SQLite updates when project package files cannot be committed', () => {
    const handler = saveHandlerBody()
    const fileWrite = handler.indexOf('await writeCanvasProjectPackageFiles(')
    const projectUpsert = handler.indexOf('projectRepo.upsert(')
    const snapshotSave = handler.indexOf('snapshotRepo.save(')

    expect(handler).not.toContain('project files failed')
    expect(fileWrite).toBeGreaterThanOrEqual(0)
    expect(fileWrite).toBeLessThan(projectUpsert)
    expect(fileWrite).toBeLessThan(snapshotSave)
  })
})
