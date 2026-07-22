import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CANVAS_PROJECTS_ROOT_GRANT_VERSION,
  authorizeCanvasProjectsRootSetting,
  readTrustedCanvasProjectsRoot,
} from './CanvasProjectsRootSetting.js'

describe('CanvasProjectsRootSetting', () => {
  let tempRoot: string
  let selectedDirectory: string
  const sender = { id: 'settings-window' }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), 'canvas-projects-root-setting-'))
    selectedDirectory = path.join(tempRoot, 'selected')
    await mkdir(selectedDirectory)
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('stores only the canonical directory returned by the sender-bound grant resolver', async () => {
    const canonical = await realpath(selectedDirectory)
    const resolveGrantedDirectory = vi.fn(() => canonical)

    const value = authorizeCanvasProjectsRootSetting(
      sender,
      { projectsRootPath: selectedDirectory, keep: 'value' },
      resolveGrantedDirectory,
    )

    expect(resolveGrantedDirectory).toHaveBeenCalledWith(sender, selectedDirectory)
    expect(value).toEqual({
      projectsRootPath: canonical,
      projectsRootPathGrantVersion: CANVAS_PROJECTS_ROOT_GRANT_VERSION,
      keep: 'value',
    })
  })

  it('rejects an ungranted or non-directory projects root', async () => {
    expect(() =>
      authorizeCanvasProjectsRootSetting(sender, { projectsRootPath: selectedDirectory }, () => {
        throw new Error('not allowed')
      }),
    ).toThrow(/无权|授权/)

    const filePath = path.join(tempRoot, 'file.txt')
    await writeFile(filePath, 'not a directory')
    expect(() =>
      authorizeCanvasProjectsRootSetting(sender, { projectsRootPath: filePath }, () => filePath),
    ).toThrow(/目录/)
  })

  it('clears the path and grant marker when the setting requests an empty root', () => {
    expect(
      authorizeCanvasProjectsRootSetting(
        sender,
        {
          projectsRootPath: '   ',
          projectsRootPathGrantVersion: CANVAS_PROJECTS_ROOT_GRANT_VERSION,
          keep: true,
        },
        () => selectedDirectory,
      ),
    ).toEqual({ keep: true })
  })

  it('reads only a v2-marked existing directory and canonicalizes symlinks', async () => {
    const link = path.join(tempRoot, 'selected-link')
    await symlink(selectedDirectory, link, 'dir')

    expect(
      readTrustedCanvasProjectsRoot({
        projectsRootPath: link,
        projectsRootPathGrantVersion: CANVAS_PROJECTS_ROOT_GRANT_VERSION,
      }),
    ).toBe(await realpath(selectedDirectory))
    expect(readTrustedCanvasProjectsRoot({ projectsRootPath: selectedDirectory })).toBeNull()
    expect(
      readTrustedCanvasProjectsRoot({
        projectsRootPath: path.join(tempRoot, 'missing'),
        projectsRootPathGrantVersion: CANVAS_PROJECTS_ROOT_GRANT_VERSION,
      }),
    ).toBeNull()
  })
})
