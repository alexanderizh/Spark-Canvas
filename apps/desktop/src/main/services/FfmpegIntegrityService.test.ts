import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isCompatibleFfmpegPair, resolveManagedBinaryDir } from './FfmpegIntegrityService.js'

describe('FfmpegIntegrityService managed boundary', () => {
  let root: string

  beforeEach(() => {
    root = join(
      tmpdir(),
      `spark-canvas-ffmpeg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('ignores scanned binaries without a Spark Canvas active manifest', () => {
    const legacy = join(root, 'FFmpeg-legacy')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'ffmpeg'), '')
    writeFileSync(join(legacy, 'ffprobe'), '')

    expect(resolveManagedBinaryDir(root, 'darwin', 'arm64')).toBeNull()
  })

  it('resolves only the versioned directory named by a matching active manifest', () => {
    const managedRoot = join(root, 'ffmpeg')
    const versionDir = join(managedRoot, '8.1.1', 'darwin-arm64')
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(join(versionDir, 'ffmpeg'), '')
    writeFileSync(join(versionDir, 'ffprobe'), '')
    writeFileSync(
      join(managedRoot, 'active.json'),
      JSON.stringify({
        schemaVersion: 1,
        product: 'spark-canvas',
        version: '8.1.1',
        platform: 'darwin',
        arch: 'arm64',
      }),
    )

    expect(resolveManagedBinaryDir(root, 'darwin', 'arm64')).toBe(versionDir)
    expect(resolveManagedBinaryDir(root, 'darwin', 'x64')).toBeNull()
  })
})

describe('FFmpeg system pair compatibility', () => {
  it('requires ffmpeg and ffprobe from the same directory and version', () => {
    expect(
      isCompatibleFfmpegPair(
        { path: '/opt/homebrew/bin/ffmpeg', version: '8.1.1' },
        { path: '/opt/homebrew/bin/ffprobe', version: '8.1.1' },
      ),
    ).toBe(true)
    expect(
      isCompatibleFfmpegPair(
        { path: '/opt/homebrew/bin/ffmpeg', version: '8.1.1' },
        { path: '/usr/local/bin/ffprobe', version: '8.1.1' },
      ),
    ).toBe(false)
    expect(
      isCompatibleFfmpegPair(
        { path: '/opt/homebrew/bin/ffmpeg', version: '8.1.1' },
        { path: '/opt/homebrew/bin/ffprobe', version: '7.1.1' },
      ),
    ).toBe(false)
  })
})
