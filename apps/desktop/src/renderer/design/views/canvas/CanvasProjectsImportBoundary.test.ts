import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'CanvasProjectsView.tsx'), 'utf8')

describe('Canvas project import presentation', () => {
  it('offers complete directory packages separately from legacy JSON snapshots', () => {
    expect(source).toContain('导入目录项目包')
    expect(source).toContain('导入旧 JSON 快照')
    expect(source).toContain('canvasApi.importProjectFromDirectory(')
    expect(source).toContain("handleImportProject('legacy-json')")
  })
})
