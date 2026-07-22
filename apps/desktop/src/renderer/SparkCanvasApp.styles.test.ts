import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('Spark Canvas shell layout styles', () => {
  it('scopes native window controls and stretches the active support view', () => {
    const styles = readFileSync(
      fileURLToPath(new URL('./SparkCanvasApp.less', import.meta.url)),
      'utf8',
    )

    expect(styles).toMatch(
      /\.spark-canvas-window-controls \.window-controls\s*\{[^}]*width:\s*auto;/s,
    )
    expect(styles).toMatch(
      /\.spark-canvas-view\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1\s+1\s+auto;/s,
    )
    expect(styles).toMatch(/\.window\.spark-canvas-app\s*\{[^}]*flex-direction:\s*row;/s)
  })
})
