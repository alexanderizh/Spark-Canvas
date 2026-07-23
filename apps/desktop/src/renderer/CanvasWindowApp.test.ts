import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { getCanvasWindowPlatformClass, readCanvasWindowProjectId } from './canvasWindowParams'

describe('readCanvasWindowProjectId', () => {
  it('returns the project id only for standalone canvas windows', () => {
    expect(readCanvasWindowProjectId('?window=canvas&projectId=canvas_project_1')).toBe(
      'canvas_project_1',
    )
    expect(readCanvasWindowProjectId('?window=chat&projectId=canvas_project_1')).toBeNull()
    expect(readCanvasWindowProjectId('?window=canvas')).toBeNull()
  })
})

describe('getCanvasWindowPlatformClass', () => {
  it('maps standalone canvas windows to normal platform classes', () => {
    expect(getCanvasWindowPlatformClass('darwin')).toBe('platform-darwin')
    expect(getCanvasWindowPlatformClass('win32')).toBe('platform-win32')
    expect(getCanvasWindowPlatformClass('linux')).toBe('platform-linux')
  })
})

describe('Canvas window runtime boundary', () => {
  it('does not mount the old platform session sidebar provider', () => {
    const source = readFileSync(join(__dirname, 'CanvasWindowApp.tsx'), 'utf8')

    expect(source).not.toContain('SessionSidebarProvider')
  })

  it('follows the shared application theme instead of forcing dark mode', () => {
    const source = readFileSync(join(__dirname, 'CanvasWindowApp.tsx'), 'utf8')
    const workspace = readFileSync(
      join(__dirname, 'design/views/canvas/CanvasWorkspaceView.tsx'),
      'utf8',
    )

    expect(source).toContain('theme-${resolvedTheme}')
    expect(source).toContain('density-${t.density}')
    expect(source).not.toContain('canvas-window-standalone theme-dark density-regular')
    expect(workspace).not.toContain("setTweak('theme', 'dark')")
  })
})
