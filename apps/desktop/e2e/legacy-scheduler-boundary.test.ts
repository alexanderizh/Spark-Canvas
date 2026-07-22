import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '../../..')

const LEGACY_SCHEDULER_FILES = [
  'apps/desktop/src/renderer/design/views/ScheduledTasksView.tsx',
  'apps/desktop/src/renderer/design/views/ScheduledTasksView.less',
  'packages/agent-runtime/src/services/scheduled-task.service.ts',
  'packages/agent-runtime/src/services/scheduled-task.service.test.ts',
  'packages/protocol/src/scheduled-task-export.ts',
  'packages/storage/src/repositories/scheduled-task.repository.ts',
  'packages/storage/src/repositories/task-execution.repository.ts',
]

const PRODUCTION_SOURCE_ROOTS = [
  'apps/desktop/src',
  'packages/agent-runtime/src',
  'packages/protocol/src',
  'packages/storage/src',
]

const LEGACY_SCHEDULER_MARKERS = [
  'ScheduledTask',
  'TaskExecution',
  'nav.tasks',
  'scheduled-task:',
  'task-execution:',
  'scheduled-tasks',
]

function listProductionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listProductionSourceFiles(path)
    if (!entry.isFile() || !/\.(?:ts|tsx|css|less)$/.test(entry.name)) return []
    if (/\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return []
    return [path]
  })
}

describe('legacy scheduler repository boundary', () => {
  it('does not retain the Scheduled Task service, repository, protocol, or UI files', () => {
    const retainedFiles = LEGACY_SCHEDULER_FILES.filter((path) => existsSync(join(REPO_ROOT, path)))

    expect(retainedFiles).toEqual([])
  })

  it('does not retain Scheduled Task or Task Execution production references', () => {
    const references = PRODUCTION_SOURCE_ROOTS.flatMap((root) =>
      listProductionSourceFiles(join(REPO_ROOT, root)).flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        return LEGACY_SCHEDULER_MARKERS.filter((marker) => source.includes(marker)).map(
          (marker) => `${relative(REPO_ROOT, path)}: ${marker}`,
        )
      }),
    )

    expect(references).toEqual([])
  })
})
