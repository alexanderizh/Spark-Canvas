import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Canvas video workbench output actions', () => {
  it('opens generated videos through the controlled file IPC instead of a safe-file browser link', () => {
    const source = readFileSync(join(__dirname, 'CanvasVideoWorkbenchModal.tsx'), 'utf8')

    expect(source).toContain("window.spark.invoke('file:open'")
    expect(source).not.toContain('target="_blank"')
    expect(source).toContain('aria-label={`播放产物 ${out.summary}`}')
  })
})
