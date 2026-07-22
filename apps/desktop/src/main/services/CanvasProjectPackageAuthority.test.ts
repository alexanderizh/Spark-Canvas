import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasFileAccessGrantService } from './CanvasFileAccessGrantService.js'
import {
  CanvasProjectPackageAuthority,
  canonicalizeExistingDirectory,
  type CanvasPackageAuthorityProject,
  type CanvasProjectPackageAuthorityDeps,
} from './CanvasProjectPackageAuthority.js'

type FakeSender = { once(event: 'destroyed', listener: () => void): void }

function createSender(): FakeSender {
  return { once: () => undefined }
}

describe('CanvasProjectPackageAuthority', () => {
  let workRoot: string
  let dbRoot: string
  let exportTarget: string
  let packageDirectory: string
  let defaultRoot: string
  let grants: CanvasFileAccessGrantService
  let mainSender: FakeSender
  let canvasSender: FakeSender
  let otherSender: FakeSender
  let projects: Map<string, CanvasPackageAuthorityProject>
  let activeProjectId: string | null
  let activeCanvasSender: FakeSender | null
  let mainAppSender: FakeSender | null

  const buildDeps = (): CanvasProjectPackageAuthorityDeps => ({
    getMainAppSender: () => mainAppSender,
    getActiveCanvasSender: () => activeCanvasSender,
    getActiveProjectId: () => activeProjectId,
    getProject: (projectId) => projects.get(projectId) ?? null,
    grants,
    getDefaultProjectsRoot: () => defaultRoot,
    canonicalizeExistingDirectory,
  })

  const build = (): CanvasProjectPackageAuthority =>
    new CanvasProjectPackageAuthority(buildDeps())

  beforeEach(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'canvas-authority-'))
    dbRoot = join(workRoot, 'projects', 'proj-1')
    exportTarget = join(workRoot, 'exports')
    packageDirectory = join(workRoot, 'chosen-package')
    defaultRoot = join(workRoot, 'default-projects')
    await mkdir(dbRoot, { recursive: true })
    await mkdir(exportTarget, { recursive: true })
    await mkdir(packageDirectory, { recursive: true })
    await mkdir(defaultRoot, { recursive: true })

    grants = new CanvasFileAccessGrantService()
    mainSender = createSender()
    canvasSender = createSender()
    otherSender = createSender()
    mainAppSender = mainSender
    activeCanvasSender = canvasSender
    activeProjectId = 'proj-1'
    projects = new Map([
      ['proj-1', { status: 'active', rootPath: dbRoot } satisfies CanvasPackageAuthorityProject],
    ])
  })

  afterEach(async () => {
    await rm(workRoot, { recursive: true, force: true })
  })

  describe('authorizeExport', () => {
    it('allows the main app to export the canonical DB root into its granted directory', () => {
      grants.grantSelectedPaths(mainSender, [exportTarget])
      expect(
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toEqual({
        projectId: 'proj-1',
        sourceRootPath: canonicalizeExistingDirectory(dbRoot),
        targetParentPath: canonicalizeExistingDirectory(exportTarget),
      })
    })

    it('allows the current canvas window to export only its active project', () => {
      grants.grantSelectedPaths(canvasSender, [exportTarget])
      expect(
        build().authorizeExport(canvasSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }).sourceRootPath,
      ).toBe(canonicalizeExistingDirectory(dbRoot))

      activeProjectId = 'proj-2'
      expect(() =>
        build().authorizeExport(canvasSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toThrow()
    })

    it('rejects an unrelated sender even when it has a directory grant', () => {
      grants.grantSelectedPaths(otherSender, [exportTarget])
      expect(() =>
        build().authorizeExport(otherSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toThrow()
    })

    it.each(['deleted', 'archived'] as const)('rejects a %s project', (status) => {
      projects.set('proj-1', { status, rootPath: dbRoot })
      grants.grantSelectedPaths(mainSender, [exportTarget])
      expect(() =>
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toThrow()
    })

    it('rejects a missing project, DB root, or on-disk root', async () => {
      grants.grantSelectedPaths(mainSender, [exportTarget])

      projects.delete('proj-1')
      expect(() =>
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toThrow()

      projects.set('proj-1', { status: 'active', rootPath: null })
      expect(() =>
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toThrow()

      projects.set('proj-1', { status: 'active', rootPath: dbRoot })
      await rm(dbRoot, { recursive: true, force: true })
      expect(() =>
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toThrow()
    })

    it('rejects an ungranted or prefix-sibling export directory', async () => {
      expect(() =>
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: exportTarget,
        }),
      ).toThrow()

      const sibling = `${exportTarget}-evil`
      await mkdir(sibling)
      grants.grantSelectedPaths(mainSender, [exportTarget])
      expect(() =>
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: sibling,
        }),
      ).toThrow()
    })

    it('rejects an export directory reached through a symlink escaping its grant', async () => {
      const outside = join(workRoot, 'outside-export')
      const escape = join(exportTarget, 'escape')
      await mkdir(outside)
      await symlink(outside, escape, 'dir')
      grants.grantSelectedPaths(mainSender, [exportTarget])
      expect(() =>
        build().authorizeExport(mainSender, {
          projectId: 'proj-1',
          targetParentDirectory: escape,
        }),
      ).toThrow()
    })
  })

  describe('authorizeImport', () => {
    it('allows the main app to import a granted package directory into the trusted default root', () => {
      grants.grantSelectedPaths(mainSender, [packageDirectory])
      expect(
        build().authorizeImport(mainSender, { sourceDirectory: packageDirectory }),
      ).toEqual({
        sourceRootPath: canonicalizeExistingDirectory(packageDirectory),
        targetParentPath: canonicalizeExistingDirectory(defaultRoot),
      })
    })

    it('allows the current canvas window when its active project is active', () => {
      grants.grantSelectedPaths(canvasSender, [packageDirectory])
      expect(
        build().authorizeImport(canvasSender, { sourceDirectory: packageDirectory }),
      ).toEqual({
        sourceRootPath: canonicalizeExistingDirectory(packageDirectory),
        targetParentPath: canonicalizeExistingDirectory(defaultRoot),
      })
    })

    it.each(['deleted', 'archived'] as const)(
      'rejects the canvas sender when its current project is %s',
      (status) => {
        projects.set('proj-1', { status, rootPath: dbRoot })
        grants.grantSelectedPaths(canvasSender, [packageDirectory])
        expect(() =>
          build().authorizeImport(canvasSender, { sourceDirectory: packageDirectory }),
        ).toThrow()
      },
    )

    it('rejects an unrelated sender and a grant owned by another sender', () => {
      grants.grantSelectedPaths(mainSender, [packageDirectory])
      expect(() =>
        build().authorizeImport(otherSender, { sourceDirectory: packageDirectory }),
      ).toThrow()

      expect(() =>
        build().authorizeImport(canvasSender, { sourceDirectory: packageDirectory }),
      ).toThrow()
    })

    it('requires the import source to be a granted directory, not a file', async () => {
      const packageFile = join(workRoot, 'project.sparkpkg')
      await writeFile(packageFile, 'not-a-directory-package')
      grants.grantSelectedPaths(mainSender, [packageFile])
      expect(() =>
        build().authorizeImport(mainSender, { sourceDirectory: packageFile }),
      ).toThrow()
    })

    it('rejects a prefix-sibling package directory', async () => {
      const sibling = `${packageDirectory}-evil`
      await mkdir(sibling)
      grants.grantSelectedPaths(mainSender, [packageDirectory])
      expect(() =>
        build().authorizeImport(mainSender, { sourceDirectory: sibling }),
      ).toThrow()
    })

    it('rejects a package directory reached through a symlink escaping its grant', async () => {
      const grantParent = join(workRoot, 'package-parent')
      const outside = join(workRoot, 'outside-package')
      const escape = join(grantParent, 'escape')
      await mkdir(grantParent)
      await mkdir(outside)
      await symlink(outside, escape, 'dir')
      grants.grantSelectedPaths(mainSender, [grantParent])
      expect(() =>
        build().authorizeImport(mainSender, { sourceDirectory: escape }),
      ).toThrow()
    })

    it('accepts an explicitly provided trusted default root without a grant', () => {
      grants.grantSelectedPaths(mainSender, [packageDirectory])
      expect(
        build().authorizeImport(mainSender, {
          sourceDirectory: packageDirectory,
          targetParentDirectory: defaultRoot,
        }).targetParentPath,
      ).toBe(canonicalizeExistingDirectory(defaultRoot))
    })

    it('accepts a same-sender granted target directory', async () => {
      const target = join(workRoot, 'import-target')
      await mkdir(target)
      grants.grantSelectedPaths(mainSender, [packageDirectory, target])
      expect(
        build().authorizeImport(mainSender, {
          sourceDirectory: packageDirectory,
          targetParentDirectory: target,
        }).targetParentPath,
      ).toBe(canonicalizeExistingDirectory(target))
    })

    it('rejects an ungranted, cross-sender, or prefix-sibling target directory', async () => {
      const target = join(workRoot, 'import-target')
      const sibling = `${target}-evil`
      await mkdir(target)
      await mkdir(sibling)
      grants.grantSelectedPaths(mainSender, [packageDirectory])
      grants.grantSelectedPaths(otherSender, [target])

      expect(() =>
        build().authorizeImport(mainSender, {
          sourceDirectory: packageDirectory,
          targetParentDirectory: target,
        }),
      ).toThrow()

      grants.grantSelectedPaths(mainSender, [target])
      expect(() =>
        build().authorizeImport(mainSender, {
          sourceDirectory: packageDirectory,
          targetParentDirectory: sibling,
        }),
      ).toThrow()
    })

    it('rejects a target reached through a symlink escaping its grant', async () => {
      const target = join(workRoot, 'import-target')
      const outside = join(workRoot, 'outside-target')
      const escape = join(target, 'escape')
      await mkdir(target)
      await mkdir(outside)
      await symlink(outside, escape, 'dir')
      grants.grantSelectedPaths(mainSender, [packageDirectory, target])
      expect(() =>
        build().authorizeImport(mainSender, {
          sourceDirectory: packageDirectory,
          targetParentDirectory: escape,
        }),
      ).toThrow()
    })

    it('fails closed when the trusted default root is missing', async () => {
      grants.grantSelectedPaths(mainSender, [packageDirectory])
      await rm(defaultRoot, { recursive: true, force: true })
      expect(() =>
        build().authorizeImport(mainSender, { sourceDirectory: packageDirectory }),
      ).toThrow()
    })
  })
})
