import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '../../..')

const LEGACY_CANVAS_FILES = [
  'apps/desktop/src/renderer/design/views/canvas/CanvasAiPanel.tsx',
  'apps/desktop/src/renderer/design/views/canvas/CanvasContextMenu.tsx',
  'apps/desktop/src/renderer/design/views/canvas/canvasConsistencyCheck.ts',
  'apps/desktop/src/renderer/design/views/canvas/canvasSelectionContext.tsx',
]

const PRODUCTION_SOURCE_ROOTS = ['apps/desktop/src']

// Import specifiers stay case-exact so the live canvasContextMenuModel.ts is not matched.
const LEGACY_CANVAS_MARKERS = [
  "'./CanvasAiPanel'",
  "'./CanvasContextMenu'",
  "'./canvasConsistencyCheck'",
  "'./canvasSelectionContext'",
  'checkCanvasTaskConsistency',
]

function listProductionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listProductionSourceFiles(path)
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return []
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return []
    return [path]
  })
}

describe('legacy unreachable Canvas modules repository boundary', () => {
  it('does not retain the four obsolete renderer module files', () => {
    const retainedFiles = LEGACY_CANVAS_FILES.filter((path) =>
      existsSync(join(REPO_ROOT, path)),
    )

    expect(retainedFiles).toEqual([])
  })

  it('does not retain production imports or references to the obsolete modules', () => {
    const references = PRODUCTION_SOURCE_ROOTS.flatMap((root) =>
      listProductionSourceFiles(join(REPO_ROOT, root)).flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        return LEGACY_CANVAS_MARKERS.filter((marker) => source.includes(marker)).map(
          (marker) => `${relative(REPO_ROOT, path)}: ${marker}`,
        )
      }),
    )

    expect(references).toEqual([])
  })
})
