import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Canvas project deletion confirmation', () => {
  it('tells the user that soft-deleted project files remain on disk', () => {
    const source = readFileSync(join(__dirname, 'CanvasProjectsView.tsx'), 'utf8')

    expect(source).toContain('项目文件夹会保留')
    expect(source).not.toContain('后续可接入恢复机制')
  })
})
