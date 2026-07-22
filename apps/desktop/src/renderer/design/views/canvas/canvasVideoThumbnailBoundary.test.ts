import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Canvas video thumbnail write boundary', () => {
  it('lets the main process choose the managed thumbnail output path', () => {
    const source = readFileSync(join(__dirname, 'canvas.api.ts'), 'utf8')
    const start = source.indexOf('async function ensureVideoThumbnail(')
    const end = source.indexOf('\n}', start)
    const implementation = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(implementation).toContain("operation: 'generateThumbnail'")
    expect(implementation).toContain('params: { atSec: 1, width: 480 }')
    expect(implementation).not.toContain('outputPath')
    expect(implementation).not.toContain('/.thumbs')
  })
})
