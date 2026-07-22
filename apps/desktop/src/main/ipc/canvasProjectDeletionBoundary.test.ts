import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Canvas project deletion boundary', () => {
  it('removes the project directory only for an explicit hard delete', () => {
    const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
    const handler = source.match(
      /typedIpcHandle\('canvas:project:delete'[\s\S]*?typedIpcHandle\('canvas:project:update-cover'/,
    )?.[0]

    expect(handler).toBeDefined()
    expect(handler).toContain('if (req.hard && rootPath)')
    expect(handler).toContain('getCanvasProjectRepo().softDelete(req.projectId)')
  })
})
