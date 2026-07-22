import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '../../..')

const LEGACY_TERMINAL_FILES = [
  'apps/desktop/src/main/services/TerminalService.ts',
  'apps/desktop/src/main/services/__tests__/TerminalService.test.ts',
  'apps/desktop/src/main/ipc/registerTerminalIpc.ts',
  'apps/desktop/src/renderer/design/components/BuiltInTerminalPanel.tsx',
  'apps/desktop/src/renderer/design/components/BuiltInTerminalPanel.less',
  'apps/desktop/src/renderer/design/hooks/useTerminalSessions.ts',
]

const PRODUCTION_SOURCE_ROOTS = [
  'apps/desktop/src',
  'packages/agent-runtime/src',
  'packages/protocol/src',
  'packages/storage/src',
]

const LEGACY_TERMINAL_MARKERS = [
  'TerminalService',
  'TerminalStreamEvent',
  'TerminalSessionInfo',
  'TerminalSessionActivity',
  'getTerminalService',
  'registerTerminalIpc',
  'BuiltInTerminalPanel',
  'useTerminalSessions',
  'terminal:list',
  'terminal:create',
  'terminal:input',
  'terminal:resize',
  'terminal:kill',
  'terminal:rename',
  'terminal:get-buffer',
  'stream:terminal:event',
  'node-pty',
  '@xterm/',
]

const BUILD_BOUNDARY_FILES = [
  'apps/desktop/package.json',
  'apps/desktop/electron-builder.yml',
  'apps/desktop/scripts/build-win-release.sh',
  'apps/desktop/scripts/rebuild-native-for-electron.sh',
  'apps/desktop/scripts/verify-native-electron-abi.cjs',
  '.github/workflows/publish-desktop-release.yml',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
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

describe('legacy built-in Terminal repository boundary', () => {
  it('does not retain PTY service or renderer files', () => {
    const retainedFiles = LEGACY_TERMINAL_FILES.filter((path) =>
      existsSync(join(REPO_ROOT, path)),
    )

    expect(retainedFiles).toEqual([])
  })

  it('does not retain PTY production references or IPC contracts', () => {
    const references = PRODUCTION_SOURCE_ROOTS.flatMap((root) =>
      listProductionSourceFiles(join(REPO_ROOT, root)).flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        return LEGACY_TERMINAL_MARKERS.filter((marker) => source.includes(marker)).map(
          (marker) => `${relative(REPO_ROOT, path)}: ${marker}`,
        )
      }),
    )

    expect(references).toEqual([])
  })

  it('does not package PTY or xterm dependencies', () => {
    const references = BUILD_BOUNDARY_FILES.flatMap((path) => {
      const source = readFileSync(join(REPO_ROOT, path), 'utf8')
      return ['node-pty', '@xterm/']
        .filter((marker) => source.includes(marker))
        .map((marker) => `${path}: ${marker}`)
    })

    expect(references).toEqual([])
  })
})
