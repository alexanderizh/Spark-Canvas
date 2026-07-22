import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as packageFiles from './CanvasProjectPackageFiles.js'

const { writeCanvasProjectPackageFiles } = packageFiles

function safeFileUrl(filePath: string): string {
  return `safe-file://local/${Buffer.from(filePath, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')}`
}

describe('Canvas project package files', () => {
  let rootPath: string
  let snapshotsDir: string
  let portableRootPath: string
  let importParentPath: string
  let outsideRootPath: string

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'spark-canvas-package-'))
    snapshotsDir = join(rootPath, 'snapshots')
    portableRootPath = `${rootPath}-portable`
    importParentPath = `${rootPath}-imports`
    outsideRootPath = `${rootPath}-outside`
    await mkdir(snapshotsDir)
    await mkdir(importParentPath)
  })

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true })
    await rm(portableRootPath, { recursive: true, force: true })
    await rm(importParentPath, { recursive: true, force: true })
    await rm(outsideRootPath, { recursive: true, force: true })
  })

  const rewritePortableSnapshot = async (mutate: (snapshot: any) => void): Promise<void> => {
    const snapshotPath = join(portableRootPath, 'snapshots', 'latest.json')
    const manifestPath = join(portableRootPath, 'project.json')
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
    mutate(snapshot)
    const snapshotText = JSON.stringify(snapshot, null, 2)
    await writeFile(snapshotPath, snapshotText, 'utf8')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.snapshot.bytes = Buffer.byteLength(snapshotText)
    manifest.snapshot.sha256 = createHash('sha256').update(snapshotText).digest('hex')
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  }

  it('exports a portable v3 directory with relative verified asset references', async () => {
    const exportPackage = (
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage?: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
          exportedAt?: string
        }) => Promise<void>
      }
    ).exportCanvasProjectDirectoryPackage
    expect(exportPackage).toBeTypeOf('function')
    if (!exportPackage) return

    const assetPath = join(rootPath, 'assets', 'videos', 'clip.mp4')
    await mkdir(join(rootPath, 'assets', 'videos'), { recursive: true })
    await writeFile(assetPath, Buffer.from('portable-video'))

    await exportPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      exportedAt: '2026-07-20T06:00:00.000Z',
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [{ id: 'node-1', data: { url: safeFileUrl(assetPath) } }],
        edges: [],
        assets: [
          {
            id: 'asset-1',
            type: 'video',
            mimeType: 'video/mp4',
            storageKey: assetPath,
            url: safeFileUrl(assetPath),
            metadata: { filePath: assetPath },
          },
        ],
        tasks: [],
      }),
    })

    const manifest = JSON.parse(await readFile(join(portableRootPath, 'project.json'), 'utf8'))
    expect(manifest).toMatchObject({
      kind: 'spark.canvas.project',
      version: 3,
      app: 'Spark Canvas',
      formatRevision: 1,
      snapshot: {
        path: 'snapshots/latest.json',
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      assets: [
        {
          path: 'assets/videos/clip.mp4',
          bytes: 14,
          mimeType: 'video/mp4',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    })
    const snapshotText = await readFile(join(portableRootPath, 'snapshots', 'latest.json'), 'utf8')
    const snapshot = JSON.parse(snapshotText)
    expect(snapshot.project.rootPath).toBeNull()
    expect(snapshot.assets[0]).toMatchObject({
      storageKey: 'assets/videos/clip.mp4',
      url: 'assets/videos/clip.mp4',
      metadata: { filePath: 'assets/videos/clip.mp4' },
    })
    expect(snapshot.nodes[0].data.url).toBe('assets/videos/clip.mp4')
    expect(snapshotText).not.toContain(rootPath)
    expect(snapshotText).not.toContain('safe-file://')
    expect(await readFile(join(portableRootPath, 'assets', 'videos', 'clip.mp4'), 'utf8')).toBe(
      'portable-video',
    )
  })

  it('accepts a snapshot root that is a canonical alias of the DB project root', async () => {
    const { exportCanvasProjectDirectoryPackage } = packageFiles as typeof packageFiles & {
      exportCanvasProjectDirectoryPackage: (input: {
        sourceRootPath: string
        targetRootPath: string
        snapshotJson: string
      }) => Promise<void>
    }
    const rootAlias = `${rootPath}-alias`
    await symlink(rootPath, rootAlias, 'dir')

    try {
      await exportCanvasProjectDirectoryPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath: rootAlias },
          board: { id: 'board-1' },
          nodes: [],
          edges: [],
          assets: [],
          tasks: [],
        }),
      })

      const snapshot = JSON.parse(
        await readFile(join(portableRootPath, 'snapshots', 'latest.json'), 'utf8'),
      )
      expect(snapshot.project.rootPath).toBeNull()
    } finally {
      await rm(rootAlias, { force: true })
    }
  })

  it('preserves text content that merely resembles an absolute file path', async () => {
    const { exportCanvasProjectDirectoryPackage } = packageFiles as typeof packageFiles & {
      exportCanvasProjectDirectoryPackage: (input: {
        sourceRootPath: string
        targetRootPath: string
        snapshotJson: string
      }) => Promise<void>
    }
    const contentText = '/INT. NIGHT is screenplay text; C:\\notes\\scene.txt is quoted dialogue.'

    await exportCanvasProjectDirectoryPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [{ id: 'node-1', data: { contentText } }],
        edges: [],
        assets: [],
        tasks: [],
      }),
    })

    const exportedSnapshot = JSON.parse(
      await readFile(join(portableRootPath, 'snapshots', 'latest.json'), 'utf8'),
    )
    expect(exportedSnapshot.nodes[0].data.contentText).toBe(contentText)
  })

  it('imports a verified v3 directory into a new project root without modifying the source', async () => {
    const exportPackage = (
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
        }) => Promise<void>
      }
    ).exportCanvasProjectDirectoryPackage
    const importPackage = (
      packageFiles as typeof packageFiles & {
        importCanvasProjectDirectoryPackage?: (input: {
          sourceRootPath: string
          targetParentPath: string
        }) => Promise<{ rootPath: string; snapshotJson: string }>
      }
    ).importCanvasProjectDirectoryPackage
    expect(importPackage).toBeTypeOf('function')
    if (!importPackage) return

    const assetPath = join(rootPath, 'assets', 'audio', 'voice.wav')
    await mkdir(join(rootPath, 'assets', 'audio'), { recursive: true })
    await writeFile(assetPath, Buffer.from('portable-audio'))
    await exportPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Voice Film', rootPath },
        board: { id: 'board-1' },
        nodes: [{ id: 'node-1', data: { url: safeFileUrl(assetPath) } }],
        edges: [],
        assets: [
          {
            id: 'asset-1',
            type: 'audio',
            mimeType: 'audio/wav',
            storageKey: assetPath,
            url: safeFileUrl(assetPath),
            metadata: { filePath: assetPath },
          },
        ],
        tasks: [],
      }),
    })
    const sourceManifestBefore = await readFile(join(portableRootPath, 'project.json'), 'utf8')

    const imported = await importPackage({
      sourceRootPath: portableRootPath,
      targetParentPath: importParentPath,
    })

    expect(imported.rootPath).not.toBe(portableRootPath)
    const snapshot = JSON.parse(imported.snapshotJson)
    const importedAssetPath = join(imported.rootPath, 'assets', 'audio', 'voice.wav')
    expect(snapshot.project.rootPath).toBe(imported.rootPath)
    expect(snapshot.assets[0]).toMatchObject({
      storageKey: importedAssetPath,
      url: safeFileUrl(importedAssetPath),
      metadata: { filePath: importedAssetPath },
    })
    expect(snapshot.nodes[0].data.url).toBe(safeFileUrl(importedAssetPath))
    expect(await readFile(importedAssetPath, 'utf8')).toBe('portable-audio')
    expect(await readFile(join(portableRootPath, 'project.json'), 'utf8')).toBe(
      sourceManifestBefore,
    )
  })

  it('imports a legacy v2 directory by remapping only files under its recorded package root', async () => {
    const { importCanvasProjectDirectoryPackage } = packageFiles as typeof packageFiles & {
      importCanvasProjectDirectoryPackage: (input: {
        sourceRootPath: string
        targetParentPath: string
      }) => Promise<{ rootPath: string; snapshotJson: string; warnings: string[] }>
    }
    const recordedRoot = '/legacy-machine/canvas-package'
    const recordedAssetPath = `${recordedRoot}/assets/videos/clip.mp4`
    const packageAssetPath = join(portableRootPath, 'assets', 'videos', 'clip.mp4')
    await mkdir(join(portableRootPath, 'assets', 'videos'), { recursive: true })
    await writeFile(packageAssetPath, Buffer.from('legacy-video'))
    await writeFile(
      join(portableRootPath, 'project.json'),
      JSON.stringify({
        kind: 'spark.canvas.project',
        version: 2,
        app: 'Spark-Agent',
        exportedAt: '2026-07-17T00:00:00.000Z',
        projectRootPath: recordedRoot,
        snapshot: {
          project: {
            id: 'legacy-project',
            title: 'Legacy Film',
            rootPath: recordedRoot,
          },
          board: { id: 'legacy-board' },
          nodes: [
            { id: 'node-1', data: { url: safeFileUrl(recordedAssetPath) } },
            { id: 'node-2', data: { url: 'safe-file://local/L2V0Yy9wYXNzd2Q=' } },
          ],
          edges: [],
          assets: [
            {
              id: 'asset-1',
              title: 'clip',
              type: 'video',
              storageKey: recordedAssetPath,
              url: safeFileUrl(recordedAssetPath),
              metadata: { filePath: recordedAssetPath },
            },
            {
              id: 'asset-2',
              title: 'outside',
              type: 'file',
              storageKey: '/etc/passwd',
              url: 'safe-file://local/L2V0Yy9wYXNzd2Q=',
              metadata: { filePath: '/etc/passwd' },
            },
          ],
          tasks: [],
        },
      }),
      'utf8',
    )
    const sourceManifestBefore = await readFile(join(portableRootPath, 'project.json'), 'utf8')

    const imported = await importCanvasProjectDirectoryPackage({
      sourceRootPath: portableRootPath,
      targetParentPath: importParentPath,
    })

    const snapshot = JSON.parse(imported.snapshotJson)
    const importedAssetPath = join(imported.rootPath, 'assets', 'videos', 'clip.mp4')
    expect(snapshot.project.rootPath).toBe(imported.rootPath)
    expect(snapshot.assets[0]).toMatchObject({
      storageKey: importedAssetPath,
      url: safeFileUrl(importedAssetPath),
      metadata: { filePath: importedAssetPath },
    })
    expect(snapshot.nodes[0].data.url).toBe(safeFileUrl(importedAssetPath))
    expect(snapshot.assets[1]).toMatchObject({
      storageKey: null,
      url: null,
      metadata: expect.not.objectContaining({ filePath: expect.anything() }),
    })
    expect(snapshot.nodes[1].data).not.toHaveProperty('url')
    expect(imported.warnings).toEqual([
      expect.stringContaining('checksum'),
      expect.stringContaining('包外'),
    ])
    expect(await readFile(importedAssetPath, 'utf8')).toBe('legacy-video')
    expect(await readFile(join(portableRootPath, 'project.json'), 'utf8')).toBe(
      sourceManifestBefore,
    )
  })

  it('imports Windows paths from a legacy v2 directory on another platform', async () => {
    const { importCanvasProjectDirectoryPackage } = packageFiles as typeof packageFiles & {
      importCanvasProjectDirectoryPackage: (input: {
        sourceRootPath: string
        targetParentPath: string
      }) => Promise<{ rootPath: string; snapshotJson: string }>
    }
    const recordedRoot = 'C:\\Legacy\\CanvasPackage'
    const recordedAssetPath = `${recordedRoot}\\assets\\videos\\clip.mp4`
    await mkdir(join(portableRootPath, 'assets', 'videos'), { recursive: true })
    await writeFile(join(portableRootPath, 'assets', 'videos', 'clip.mp4'), 'windows-video')
    await writeFile(
      join(portableRootPath, 'project.json'),
      JSON.stringify({
        kind: 'spark.canvas.project',
        version: 2,
        app: 'Spark-Agent',
        projectRootPath: recordedRoot,
        snapshot: {
          project: { id: 'legacy-project', title: 'Windows Film', rootPath: recordedRoot },
          board: { id: 'legacy-board' },
          nodes: [],
          edges: [],
          assets: [
            {
              id: 'asset-1',
              type: 'video',
              storageKey: recordedAssetPath,
              url: safeFileUrl(recordedAssetPath),
              metadata: { filePath: recordedAssetPath },
            },
          ],
          tasks: [],
        },
      }),
      'utf8',
    )

    const imported = await importCanvasProjectDirectoryPackage({
      sourceRootPath: portableRootPath,
      targetParentPath: importParentPath,
    })

    const snapshot = JSON.parse(imported.snapshotJson)
    const importedAssetPath = join(imported.rootPath, 'assets', 'videos', 'clip.mp4')
    expect(snapshot.assets[0]).toMatchObject({
      storageKey: importedAssetPath,
      url: safeFileUrl(importedAssetPath),
      metadata: { filePath: importedAssetPath },
    })
    expect(await readFile(importedAssetPath, 'utf8')).toBe('windows-video')
  })

  it.each(['bytes', 'sha256'] as const)(
    'rejects a v3 package whose declared asset %s does not match the file',
    async (field) => {
      const exportPackage = (
        packageFiles as typeof packageFiles & {
          exportCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetRootPath: string
            snapshotJson: string
          }) => Promise<void>
          importCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetParentPath: string
          }) => Promise<unknown>
        }
      ).exportCanvasProjectDirectoryPackage
      const importPackage = (
        packageFiles as typeof packageFiles & {
          importCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetParentPath: string
          }) => Promise<unknown>
        }
      ).importCanvasProjectDirectoryPackage
      const assetPath = join(rootPath, 'assets', 'videos', 'clip.mp4')
      await mkdir(join(rootPath, 'assets', 'videos'), { recursive: true })
      await writeFile(assetPath, Buffer.from('integrity-video'))
      await exportPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath },
          board: { id: 'board-1' },
          nodes: [{ id: 'node-1', data: { url: safeFileUrl(assetPath) } }],
          edges: [],
          assets: [
            {
              id: 'asset-1',
              type: 'video',
              storageKey: assetPath,
              url: safeFileUrl(assetPath),
              metadata: { filePath: assetPath },
            },
          ],
          tasks: [],
        }),
      })
      const manifestPath = join(portableRootPath, 'project.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (field === 'bytes') manifest.assets[0].bytes += 1
      else manifest.assets[0].sha256 = '0'.repeat(64)
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

      await expect(
        importPackage({
          sourceRootPath: portableRootPath,
          targetParentPath: importParentPath,
        }),
      ).rejects.toThrow(/size|checksum|integrity/i)
      expect(await readdir(importParentPath)).toEqual([])
    },
  )

  it.each(['/etc/passwd', 'safe-file://local/L2V0Yy9wYXNzd2Q='])(
    'rejects a verified v3 snapshot containing the non-portable reference %s',
    async (unsafeReference) => {
      const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
        packageFiles as typeof packageFiles & {
          exportCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetRootPath: string
            snapshotJson: string
          }) => Promise<void>
          importCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetParentPath: string
          }) => Promise<unknown>
        }
      const assetPath = join(rootPath, 'assets', 'videos', 'clip.mp4')
      await mkdir(join(rootPath, 'assets', 'videos'), { recursive: true })
      await writeFile(assetPath, Buffer.from('portable-video'))
      await exportCanvasProjectDirectoryPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath },
          board: { id: 'board-1' },
          nodes: [],
          edges: [],
          assets: [
            {
              id: 'asset-1',
              type: 'video',
              storageKey: assetPath,
              url: safeFileUrl(assetPath),
              metadata: { filePath: assetPath },
            },
          ],
          tasks: [],
        }),
      })
      await rewritePortableSnapshot((snapshot) => {
        snapshot.assets[0].storageKey = unsafeReference
      })

      await expect(
        importCanvasProjectDirectoryPackage({
          sourceRootPath: portableRootPath,
          targetParentPath: importParentPath,
        }),
      ).rejects.toThrow(/absolute|relative|safe-file|portable/i)
      expect(await readdir(importParentPath)).toEqual([])
    },
  )

  it('rejects a package asset reached through a directory symlink outside the package root', async () => {
    const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
        }) => Promise<void>
        importCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetParentPath: string
        }) => Promise<unknown>
      }
    const assetPath = join(rootPath, 'assets', 'videos', 'clip.mp4')
    await mkdir(join(rootPath, 'assets', 'videos'), { recursive: true })
    await writeFile(assetPath, Buffer.from('portable-video'))
    await exportCanvasProjectDirectoryPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [],
        edges: [],
        assets: [
          {
            id: 'asset-1',
            type: 'video',
            storageKey: assetPath,
            url: safeFileUrl(assetPath),
            metadata: { filePath: assetPath },
          },
        ],
        tasks: [],
      }),
    })
    const packageVideosPath = join(portableRootPath, 'assets', 'videos')
    await rm(packageVideosPath, { recursive: true, force: true })
    await mkdir(outsideRootPath)
    await writeFile(join(outsideRootPath, 'clip.mp4'), Buffer.from('portable-video'))
    await symlink(outsideRootPath, packageVideosPath, 'dir')

    await expect(
      importCanvasProjectDirectoryPackage({
        sourceRootPath: portableRootPath,
        targetParentPath: importParentPath,
      }),
    ).rejects.toThrow(/symbolic|outside|package root/i)
    expect(await readdir(importParentPath)).toEqual([])
  })

  it.each(['duplicate-asset', 'snapshot-asset-conflict'] as const)(
    'rejects a manifest path collision: %s',
    async (collision) => {
      const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
        packageFiles as typeof packageFiles & {
          exportCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetRootPath: string
            snapshotJson: string
          }) => Promise<void>
          importCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetParentPath: string
          }) => Promise<unknown>
        }
      const assetPath = join(rootPath, 'assets', 'videos', 'clip.mp4')
      await mkdir(join(rootPath, 'assets', 'videos'), { recursive: true })
      await writeFile(assetPath, Buffer.from('portable-video'))
      await exportCanvasProjectDirectoryPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath },
          board: { id: 'board-1' },
          nodes: [],
          edges: [],
          assets: [
            {
              id: 'asset-1',
              type: 'video',
              storageKey: assetPath,
              url: safeFileUrl(assetPath),
              metadata: { filePath: assetPath },
            },
          ],
          tasks: [],
        }),
      })
      const manifestPath = join(portableRootPath, 'project.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (collision === 'duplicate-asset') {
        manifest.assets.push({ ...manifest.assets[0] })
      } else {
        manifest.assets.push({
          ...manifest.snapshot,
          mimeType: 'application/json',
        })
      }
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

      await expect(
        importCanvasProjectDirectoryPackage({
          sourceRootPath: portableRootPath,
          targetParentPath: importParentPath,
        }),
      ).rejects.toThrow(/collision|conflict|duplicate/i)
      expect(await readdir(importParentPath)).toEqual([])
    },
  )

  it.each(['single-asset', 'total-package'] as const)(
    'rejects a manifest that exceeds the %s size limit before reading undeclared files',
    async (limitKind) => {
      const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
        packageFiles as typeof packageFiles & {
          exportCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetRootPath: string
            snapshotJson: string
          }) => Promise<void>
          importCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetParentPath: string
          }) => Promise<unknown>
        }
      const assetPath = join(rootPath, 'assets', 'videos', 'clip.mp4')
      await mkdir(join(rootPath, 'assets', 'videos'), { recursive: true })
      await writeFile(assetPath, Buffer.from('portable-video'))
      await exportCanvasProjectDirectoryPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath },
          board: { id: 'board-1' },
          nodes: [],
          edges: [],
          assets: [
            {
              id: 'asset-1',
              type: 'video',
              storageKey: assetPath,
              url: safeFileUrl(assetPath),
              metadata: { filePath: assetPath },
            },
          ],
          tasks: [],
        }),
      })
      const manifestPath = join(portableRootPath, 'project.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (limitKind === 'single-asset') {
        manifest.assets[0].bytes = 20 * 1024 * 1024 * 1024
      } else {
        for (let index = 0; index < 20; index += 1) {
          manifest.assets.push({
            path: `assets/videos/missing-${index}.mp4`,
            sha256: '0'.repeat(64),
            bytes: 6 * 1024 * 1024 * 1024,
            mimeType: 'video/mp4',
          })
        }
      }
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

      await expect(
        importCanvasProjectDirectoryPackage({
          sourceRootPath: portableRootPath,
          targetParentPath: importParentPath,
        }),
      ).rejects.toThrow(/size limit|package limit/i)
      expect(await readdir(importParentPath)).toEqual([])
    },
  )

  it('rejects a v3 manifest that is missing the required format revision', async () => {
    const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
        }) => Promise<void>
        importCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetParentPath: string
        }) => Promise<unknown>
      }
    await exportCanvasProjectDirectoryPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [],
        edges: [],
        assets: [],
        tasks: [],
      }),
    })
    const manifestPath = join(portableRootPath, 'project.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.formatRevision
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    await expect(
      importCanvasProjectDirectoryPackage({
        sourceRootPath: portableRootPath,
        targetParentPath: importParentPath,
      }),
    ).rejects.toThrow(/manifest|format revision/i)
    expect(await readdir(importParentPath)).toEqual([])
  })

  it('rejects an export snapshot containing an undecodable safe-file reference', async () => {
    const { exportCanvasProjectDirectoryPackage } = packageFiles as typeof packageFiles & {
      exportCanvasProjectDirectoryPackage: (input: {
        sourceRootPath: string
        targetRootPath: string
        snapshotJson: string
      }) => Promise<void>
    }

    await expect(
      exportCanvasProjectDirectoryPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath },
          board: { id: 'board-1' },
          nodes: [{ id: 'node-1', data: { url: 'safe-file://local/not-a-local-path' } }],
          edges: [],
          assets: [],
          tasks: [],
        }),
      }),
    ).rejects.toThrow(/safe-file|portable/i)
    await expect(readFile(join(portableRootPath, 'project.json'), 'utf8')).rejects.toThrow()
  })

  it('ignores package files that are not declared by the verified manifest', async () => {
    const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
        }) => Promise<void>
        importCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetParentPath: string
        }) => Promise<{ rootPath: string }>
      }
    await exportCanvasProjectDirectoryPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [],
        edges: [],
        assets: [],
        tasks: [],
      }),
    })
    const extraAssetPath = join(portableRootPath, 'assets', 'videos', 'undeclared.mp4')
    await mkdir(join(portableRootPath, 'assets', 'videos'), { recursive: true })
    await writeFile(extraAssetPath, Buffer.from('undeclared'))

    const imported = await importCanvasProjectDirectoryPackage({
      sourceRootPath: portableRootPath,
      targetParentPath: importParentPath,
    })

    await expect(
      readFile(join(imported.rootPath, 'assets', 'videos', 'undeclared.mp4')),
    ).rejects.toThrow()
    expect(await readFile(extraAssetPath, 'utf8')).toBe('undeclared')
  })

  it('rejects an invalid snapshot shape before committing an imported directory', async () => {
    const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
        }) => Promise<void>
        importCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetParentPath: string
        }) => Promise<unknown>
      }
    await exportCanvasProjectDirectoryPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [],
        edges: [],
        assets: [],
        tasks: [],
      }),
    })
    await rewritePortableSnapshot((snapshot) => {
      delete snapshot.tasks
    })

    await expect(
      importCanvasProjectDirectoryPackage({
        sourceRootPath: portableRootPath,
        targetParentPath: importParentPath,
      }),
    ).rejects.toThrow(/snapshot|tasks/i)
    expect(await readdir(importParentPath)).toEqual([])
  })

  it('rejects an import target located inside the source package', async () => {
    const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
        }) => Promise<void>
        importCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetParentPath: string
        }) => Promise<unknown>
      }
    await exportCanvasProjectDirectoryPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [],
        edges: [],
        assets: [],
        tasks: [],
      }),
    })
    const sourceEntriesBefore = await readdir(portableRootPath)

    await expect(
      importCanvasProjectDirectoryPackage({
        sourceRootPath: portableRootPath,
        targetParentPath: portableRootPath,
      }),
    ).rejects.toThrow(/source package|target/i)
    expect(await readdir(portableRootPath)).toEqual(sourceEntriesBefore)
  })

  it.each(['/tmp/outside.mp4', '../outside.mp4', 'assets\\videos\\clip.mp4'])(
    'rejects the unsafe manifest asset path %s',
    async (unsafePath) => {
      const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
        packageFiles as typeof packageFiles & {
          exportCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetRootPath: string
            snapshotJson: string
          }) => Promise<void>
          importCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetParentPath: string
          }) => Promise<unknown>
        }
      const assetPath = join(rootPath, 'assets', 'videos', 'clip.mp4')
      await mkdir(join(rootPath, 'assets', 'videos'), { recursive: true })
      await writeFile(assetPath, Buffer.from('portable-video'))
      await exportCanvasProjectDirectoryPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath },
          board: { id: 'board-1' },
          nodes: [],
          edges: [],
          assets: [
            {
              id: 'asset-1',
              type: 'video',
              storageKey: assetPath,
              url: safeFileUrl(assetPath),
              metadata: { filePath: assetPath },
            },
          ],
          tasks: [],
        }),
      })
      const manifestPath = join(portableRootPath, 'project.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      manifest.assets[0].path = unsafePath
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

      await expect(
        importCanvasProjectDirectoryPackage({
          sourceRootPath: portableRootPath,
          targetParentPath: importParentPath,
        }),
      ).rejects.toThrow(/asset path|relative path|invalid/i)
      expect(await readdir(importParentPath)).toEqual([])
    },
  )

  it('rejects a snapshot checksum mismatch before creating an import directory', async () => {
    const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
      packageFiles as typeof packageFiles & {
        exportCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetRootPath: string
          snapshotJson: string
        }) => Promise<void>
        importCanvasProjectDirectoryPackage: (input: {
          sourceRootPath: string
          targetParentPath: string
        }) => Promise<unknown>
      }
    await exportCanvasProjectDirectoryPackage({
      sourceRootPath: rootPath,
      targetRootPath: portableRootPath,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film', rootPath },
        board: { id: 'board-1' },
        nodes: [],
        edges: [],
        assets: [],
        tasks: [],
      }),
    })
    const snapshotPath = join(portableRootPath, 'snapshots', 'latest.json')
    await writeFile(snapshotPath, '{}', 'utf8')

    await expect(
      importCanvasProjectDirectoryPackage({
        sourceRootPath: portableRootPath,
        targetParentPath: importParentPath,
      }),
    ).rejects.toThrow(/snapshot (?:size|checksum) mismatch/i)
    expect(await readdir(importParentPath)).toEqual([])
  })

  it.each(['project.json', 'snapshot-parent'] as const)(
    'rejects a package reached through a %s symlink',
    async (symlinkKind) => {
      const { exportCanvasProjectDirectoryPackage, importCanvasProjectDirectoryPackage } =
        packageFiles as typeof packageFiles & {
          exportCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetRootPath: string
            snapshotJson: string
          }) => Promise<void>
          importCanvasProjectDirectoryPackage: (input: {
            sourceRootPath: string
            targetParentPath: string
          }) => Promise<unknown>
        }
      await exportCanvasProjectDirectoryPackage({
        sourceRootPath: rootPath,
        targetRootPath: portableRootPath,
        snapshotJson: JSON.stringify({
          project: { id: 'canvas-project-1', title: 'Film', rootPath },
          board: { id: 'board-1' },
          nodes: [],
          edges: [],
          assets: [],
          tasks: [],
        }),
      })
      await mkdir(outsideRootPath)
      if (symlinkKind === 'project.json') {
        const manifestPath = join(portableRootPath, 'project.json')
        const outsideManifestPath = join(outsideRootPath, 'project.json')
        await writeFile(outsideManifestPath, await readFile(manifestPath))
        await rm(manifestPath)
        await symlink(outsideManifestPath, manifestPath, 'file')
      } else {
        const snapshotsPath = join(portableRootPath, 'snapshots')
        await writeFile(
          join(outsideRootPath, 'latest.json'),
          await readFile(join(snapshotsPath, 'latest.json')),
        )
        await rm(snapshotsPath, { recursive: true })
        await symlink(outsideRootPath, snapshotsPath, 'dir')
      }

      await expect(
        importCanvasProjectDirectoryPackage({
          sourceRootPath: portableRootPath,
          targetParentPath: importParentPath,
        }),
      ).rejects.toThrow(/symbolic link/i)
      expect(await readdir(importParentPath)).toEqual([])
    },
  )

  it('atomically writes the project package, latest snapshot, and dated snapshot', async () => {
    const exportedAt = '2026-07-20T05:00:00.000Z'
    const result = await writeCanvasProjectPackageFiles({
      rootPath,
      snapshotsDir,
      snapshotJson: JSON.stringify({
        project: { id: 'canvas-project-1', title: 'Film' },
        nodes: [],
      }),
      exportedAt,
    })

    expect(JSON.parse(result.snapshotJson).project.rootPath).toBe(rootPath)
    const projectPackage = JSON.parse(await readFile(join(rootPath, 'project.json'), 'utf8'))
    expect(projectPackage).toMatchObject({
      kind: 'spark.canvas.project',
      version: 2,
      app: 'spark-canvas',
      projectRootPath: rootPath,
    })
    expect(JSON.parse(await readFile(join(snapshotsDir, 'latest.json'), 'utf8'))).toMatchObject({
      project: { id: 'canvas-project-1', rootPath },
    })
    expect(await readdir(snapshotsDir)).toEqual(['2026-07-20T05-00-00-000Z.json', 'latest.json'])
    expect((await readdir(rootPath)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('rejects instead of reporting success when a snapshot file cannot be written', async () => {
    const blockedSnapshotsPath = join(rootPath, 'blocked-snapshots')
    await writeFile(blockedSnapshotsPath, 'not a directory', 'utf8')

    await expect(
      writeCanvasProjectPackageFiles({
        rootPath,
        snapshotsDir: blockedSnapshotsPath,
        snapshotJson: JSON.stringify({ project: { id: 'canvas-project-1' } }),
      }),
    ).rejects.toThrow()
  })
})
