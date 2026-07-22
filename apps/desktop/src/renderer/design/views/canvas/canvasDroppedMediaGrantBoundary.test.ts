import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'CanvasWorkspaceView.tsx'), 'utf8')

describe('Canvas dropped media grant boundary', () => {
  it('uses the preload drop grant instead of Electron File.path', () => {
    const start = source.indexOf('const handleDropFiles = useCallback(')
    const end = source.indexOf('const handleUploadFilesChange', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const handler = source.slice(start, end)

    expect(handler).toContain('window.spark.grantDroppedFiles(files)')
    expect(handler).not.toContain("File & { path?: string }")
  })
})
