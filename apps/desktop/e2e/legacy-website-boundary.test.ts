import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '../../..')
const LEGACY_WEBSITE_PATH = normalize(join(REPO_ROOT, 'apps/website'))
const WORKFLOWS_DIR = join(REPO_ROOT, '.github/workflows')

describe('legacy website repository boundary', () => {
  it('excludes apps/website from the pnpm workspace project graph', () => {
    const result = spawnSync('pnpm', ['--recursive', 'list', '--depth', '-1', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })

    expect(result.error).toBeUndefined()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)

    const projects = JSON.parse(result.stdout) as Array<{ path: string }>
    expect(projects.map((project) => normalize(project.path))).not.toContain(LEGACY_WEBSITE_PATH)
  })

  it('has no GitHub Actions entry point for the legacy website release chain', () => {
    const legacyWorkflowPath = join(WORKFLOWS_DIR, 'publish-website.yml')
    expect(existsSync(legacyWorkflowPath)).toBe(false)

    const legacyReleaseWorkflows = readdirSync(WORKFLOWS_DIR)
      .filter((file) => /\.ya?ml$/.test(file))
      .filter((file) => {
        const source = readFileSync(join(WORKFLOWS_DIR, file), 'utf8')
        return source.includes('apps/website') || /WEBSITE_(?:DOCKER|SERVER)_/.test(source)
      })

    expect(legacyReleaseWorkflows).toEqual([])
  })
})
