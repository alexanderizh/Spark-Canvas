import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { rewriteCanvasSnapshotRootPaths } from './canvasProjectAssetMigration.js'

const fromRoot = path.resolve('/source/exported-project')
const toRoot = path.resolve('/selected/project-package')

function encodeSafeFileUrl(filePath: string): string {
  return `safe-file://local/${Buffer.from(filePath, 'utf8').toString('base64url')}`
}

function decodeSafeFileUrl(value: string | undefined): string | null {
  if (!value?.startsWith('safe-file://local/')) return null
  return Buffer.from(value.slice('safe-file://local/'.length), 'base64url').toString('utf8')
}

describe('rewriteCanvasSnapshotRootPaths', () => {
  it('rewrites absolute and safe-file asset paths inside an imported package', () => {
    const imagePath = path.join(fromRoot, 'assets', 'images', 'frame.png')
    const videoPath = path.join(fromRoot, 'assets', 'videos', 'clip.mp4')

    expect(
      rewriteCanvasSnapshotRootPaths(
        {
          assets: [{ url: encodeSafeFileUrl(imagePath), storageKey: videoPath }],
          remoteUrl: 'https://example.com/frame.png',
        },
        fromRoot,
        toRoot,
        decodeSafeFileUrl,
        encodeSafeFileUrl,
      ),
    ).toEqual({
      assets: [
        {
          url: encodeSafeFileUrl(path.join(toRoot, 'assets', 'images', 'frame.png')),
          storageKey: path.join(toRoot, 'assets', 'videos', 'clip.mp4'),
        },
      ],
      remoteUrl: 'https://example.com/frame.png',
    })
  })

  it('does not rewrite sibling paths outside the exported root', () => {
    const siblingPath = path.resolve(`${fromRoot}-backup`, 'secret.txt')

    expect(
      rewriteCanvasSnapshotRootPaths(
        siblingPath,
        fromRoot,
        toRoot,
        decodeSafeFileUrl,
        encodeSafeFileUrl,
      ),
    ).toBe(siblingPath)
  })
})
