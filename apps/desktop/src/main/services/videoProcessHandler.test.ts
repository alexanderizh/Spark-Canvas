import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  root: '',
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData' ? join(state.root, 'user-data') : join(state.root, name),
  },
}))

vi.mock('./SafeFileProtocol.js', () => ({
  getSafeFileAllowedRoots: () => [state.root],
}))

vi.mock('./FfmpegRunner.js', () => ({
  addWatermark: vi.fn(),
  adjustSpeed: vi.fn(),
  burnSubtitle: vi.fn(),
  concatVideos: vi.fn(),
  cropVideo: vi.fn(),
  extractFramesAtTimes: vi.fn(),
  extractKeyframes: vi.fn(),
  generateThumbnail: vi.fn(),
  probeVideo: vi.fn(async () => ({ durationSec: 1 })),
  reverseVideo: vi.fn(),
  segmentVideo: vi.fn(),
  transcodeVideo: vi.fn(),
  trimVideo: vi.fn(async (_input: string, outputPath: string) => {
    if (!existsSync(dirname(outputPath))) {
      throw new Error(`output directory missing: ${dirname(outputPath)}`)
    }
    writeFileSync(outputPath, 'trimmed')
    return { path: outputPath }
  }),
}))

import { handleVideoProcess } from './videoProcessHandler.js'

describe('video process handler', () => {
  let outsideRoot = ''

  beforeAll(() => {
    state.root = mkdtempSync(join(tmpdir(), 'spark-canvas-video-handler-'))
    outsideRoot = mkdtempSync(join(tmpdir(), 'spark-canvas-video-outside-'))
    writeFileSync(join(state.root, 'source.mp4'), 'fixture')
    writeFileSync(join(outsideRoot, 'outside.mp4'), 'outside')
    symlinkSync(
      outsideRoot,
      join(state.root, 'escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  })

  afterAll(() => {
    rmSync(state.root, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('creates the managed artifact directory before the first generated output', async () => {
    const response = await handleVideoProcess({
      operation: 'trim',
      input: join(state.root, 'source.mp4'),
      params: { startSec: 0, endSec: 1 },
      requestId: 'first-output',
    })

    expect(response.success).toBe(true)
    expect(response.result).toMatchObject({ path: expect.stringContaining('video-workbench') })
  })

  it('rejects a source path whose symlink escapes an allowed root', async () => {
    const response = await handleVideoProcess({
      operation: 'probe',
      input: join(state.root, 'escape', 'outside.mp4'),
      params: {},
      requestId: 'symlink-escape',
    })

    expect(response.success).toBe(false)
    expect(response.error).toContain('outside allowed roots')
  })
})
