import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '../../..')

const LEGACY_FILE_WATCHER_FILES = ['apps/desktop/src/main/services/FileWatcherService.ts']

const PRODUCTION_SOURCE_ROOTS = [
  'apps/desktop/src',
  'packages/agent-runtime/src',
  'packages/protocol/src',
  'packages/storage/src',
]

const LEGACY_FILE_WATCHER_MARKERS = [
  'FileWatcherService',
  'WorkspaceFileChangePayload',
  'getFileWatcherService',
  'workspace:watch-start',
  'workspace:watch-stop',
  'stream:workspace:file-change',
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

describe('legacy FileWatcher repository boundary', () => {
  it('does not retain the FileWatcher service file', () => {
    const retainedFiles = LEGACY_FILE_WATCHER_FILES.filter((path) =>
      existsSync(join(REPO_ROOT, path)),
    )

    expect(retainedFiles).toEqual([])
  })

  it('does not retain FileWatcher production references or IPC contracts', () => {
    const references = PRODUCTION_SOURCE_ROOTS.flatMap((root) =>
      listProductionSourceFiles(join(REPO_ROOT, root)).flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        return LEGACY_FILE_WATCHER_MARKERS.filter((marker) => source.includes(marker)).map(
          (marker) => `${relative(REPO_ROOT, path)}: ${marker}`,
        )
      }),
    )

    expect(references).toEqual([])
  })
})
