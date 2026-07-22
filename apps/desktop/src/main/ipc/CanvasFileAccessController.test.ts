import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkError } from '@spark/shared'
import type { CanvasFileAccessGrantSender } from '../services/CanvasFileAccessGrantService.js'
import { MAX_CANVAS_TEXT_FILE_BYTES } from '../services/CanvasFileAccessGrantService.js'
import {
  CanvasFileAccessController,
  type CanvasFileAccessControllerDeps,
  type CanvasOpenDialogResult,
} from './CanvasFileAccessController.js'

class FakeSender implements CanvasFileAccessGrantSender {
  private readonly destroyedListeners: Array<() => void> = []

  once(event: 'destroyed', listener: () => void): void {
    if (event === 'destroyed') this.destroyedListeners.push(listener)
  }
}

/** 真实文件系统的 stat/readText 注入，配合临时目录驱动 grant 服务的 realpath 校验。 */
function realFileStat(path: string): { isFile(): boolean; isDirectory(): boolean } | null {
  if (!existsSync(path)) return null
  return statSync(path)
}

interface Harness {
  controller: CanvasFileAccessController
  deps: CanvasFileAccessControllerDeps
  /** 下一次 openDirectory/openFile 返回的对话框结果。 */
  dialogResult: CanvasOpenDialogResult
  /** 按 sender 配置可信 DB project root。 */
  trustedRoots: Map<CanvasFileAccessGrantSender, string>
}

function createHarness(): Harness {
  const trustedRoots = new Map<CanvasFileAccessGrantSender, string>()
  const state = { dialogResult: { canceled: true, filePaths: [] } as CanvasOpenDialogResult }
  const deps: CanvasFileAccessControllerDeps = {
    openDirectory: async () => state.dialogResult,
    openFile: async () => state.dialogResult,
    stat: realFileStat,
    readText: (path) => readFileSync(path, 'utf-8'),
    resolveTrustedProjectRoot: (sender) => trustedRoots.get(sender) ?? null,
  }
  return {
    controller: new CanvasFileAccessController(deps),
    deps,
    trustedRoots,
    get dialogResult() {
      return state.dialogResult
    },
    set dialogResult(value: CanvasOpenDialogResult) {
      state.dialogResult = value
    },
  }
}

function expectPermissionDenied(run: () => unknown): void {
  try {
    run()
    expect.unreachable('expected a PERMISSION_DENIED SparkError')
  } catch (err) {
    expect(err).toBeInstanceOf(SparkError)
    expect((err as SparkError).code).toBe('PERMISSION_DENIED')
  }
}

describe('CanvasFileAccessController', () => {
  let tempRoot: string
  let harness: Harness

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'spark-canvas-file-controller-'))
    harness = createHarness()
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('grants the selected directory to the original sender and rejects other senders', async () => {
    const selectedDir = join(tempRoot, 'workspace')
    const child = join(selectedDir, 'notes.txt')
    await mkdir(selectedDir)
    await writeFile(child, 'hello')
    const sender = new FakeSender()
    const otherSender = new FakeSender()
    harness.dialogResult = { canceled: false, filePaths: [selectedDir] }

    const response = await harness.controller.openDirectory(sender, {})

    expect(response).toEqual({ canceled: false, filePath: selectedDir })
    expect(harness.controller.statKind(sender, child)).toBe('file')
    expectPermissionDenied(() => harness.controller.statKind(otherSender, child))
  })

  it('grants every selected file and returns both filePath and filePaths on multi-select', async () => {
    const first = join(tempRoot, 'first.txt')
    const second = join(tempRoot, 'second.txt')
    await writeFile(first, 'a')
    await writeFile(second, 'b')
    const sender = new FakeSender()
    harness.dialogResult = { canceled: false, filePaths: [first, second] }

    const response = await harness.controller.openFile(sender, { multiple: true })

    expect(response).toEqual({ canceled: false, filePath: first, filePaths: [first, second] })
    expect(harness.controller.statKind(sender, first)).toBe('file')
    expect(harness.controller.statKind(sender, second)).toBe('file')
  })

  it('does not grant anything when the dialog is canceled', async () => {
    const file = join(tempRoot, 'secret.txt')
    await writeFile(file, 'secret')
    const sender = new FakeSender()
    harness.dialogResult = { canceled: true, filePaths: [] }

    const response = await harness.controller.openDirectory(sender, {})

    expect(response).toEqual({ canceled: true })
    expectPermissionDenied(() => harness.controller.statKind(sender, file))
  })

  it('grants dropped files only to a sender with an active trusted project root', async () => {
    const projectRoot = join(tempRoot, 'project')
    const droppedVideo = join(tempRoot, 'dropped.mp4')
    await mkdir(projectRoot)
    await writeFile(droppedVideo, 'video')
    const sender = new FakeSender()
    const otherSender = new FakeSender()
    harness.trustedRoots.set(sender, projectRoot)

    expect(harness.controller.grantDroppedPaths(sender, [droppedVideo])).toEqual([
      await realpath(droppedVideo),
    ])
    expect(harness.controller.statKind(sender, droppedVideo)).toBe('file')
    expectPermissionDenied(() =>
      harness.controller.grantDroppedPaths(otherSender, [droppedVideo]),
    )
  })

  it('authorizes files under the trusted DB project root without an explicit grant', async () => {
    const projectRoot = join(tempRoot, 'project')
    const projectFile = join(projectRoot, 'main.ts')
    await mkdir(projectRoot)
    await writeFile(projectFile, 'code')
    const sender = new FakeSender()
    harness.trustedRoots.set(sender, projectRoot)

    expect(harness.controller.statKind(sender, projectFile)).toBe('file')
    expect(harness.controller.statKind(sender, projectRoot)).toBe('directory')
  })

  it('returns absent only inside an authorized root and denies unauthorized missing paths', async () => {
    const projectRoot = join(tempRoot, 'project')
    const missing = join(projectRoot, 'nope.txt')
    const unauthorizedMissing = join(tempRoot, 'private-missing.txt')
    const unauthorized = join(tempRoot, 'private.txt')
    await mkdir(projectRoot)
    await writeFile(unauthorized, 'private')
    const sender = new FakeSender()
    harness.trustedRoots.set(sender, projectRoot)

    expect(harness.controller.statKind(sender, missing)).toBe('absent')
    expectPermissionDenied(() => harness.controller.statKind(sender, unauthorizedMissing))
    expectPermissionDenied(() => harness.controller.statKind(sender, unauthorized))
  })

  it('reads granted text files but enforces the 2 MiB ceiling and grant boundary', async () => {
    const dir = join(tempRoot, 'granted')
    const readable = join(dir, 'ok.txt')
    const oversized = join(dir, 'big.txt')
    const outside = join(tempRoot, 'outside.txt')
    await mkdir(dir)
    await writeFile(readable, 'readable-content')
    await writeFile(oversized, '')
    await truncate(oversized, MAX_CANVAS_TEXT_FILE_BYTES + 1)
    await writeFile(outside, 'outside')
    const sender = new FakeSender()
    harness.dialogResult = { canceled: false, filePaths: [dir] }
    await harness.controller.openDirectory(sender, {})

    expect(harness.controller.readText(sender, readable)).toEqual({ content: 'readable-content' })
    expect(() => harness.controller.readText(sender, oversized)).toThrow(/2 MiB/i)
    expect(() => harness.controller.readText(sender, outside)).toThrow(/not allowed/i)
  })

  it('validates attachments to canonical paths and rejects type mismatch or unauthorized paths', async () => {
    const dir = join(tempRoot, 'attachments')
    const image = join(dir, 'shot.png')
    const doc = join(dir, 'report.pdf')
    const subDir = join(dir, 'nested')
    const outside = join(tempRoot, 'foreign.png')
    await mkdir(subDir, { recursive: true })
    await writeFile(image, 'png')
    await writeFile(doc, 'pdf')
    await writeFile(outside, 'foreign')
    const sender = new FakeSender()
    harness.dialogResult = { canceled: false, filePaths: [dir] }
    await harness.controller.openDirectory(sender, {})

    const validated = harness.controller.validateAttachments(sender, undefined, [
      { type: 'image', path: image },
      { type: 'file', path: doc },
      { type: 'directory', path: subDir },
    ])
    expect(validated).toEqual([
      { type: 'image', path: await realpath(image) },
      { type: 'file', path: await realpath(doc) },
      { type: 'directory', path: await realpath(subDir) },
    ])

    // directory 声明为 image → 类型不符
    expectPermissionDenied(() =>
      harness.controller.validateAttachments(sender, undefined, [{ type: 'image', path: subDir }]),
    )
    // file 声明为 directory → 类型不符
    expectPermissionDenied(() =>
      harness.controller.validateAttachments(sender, undefined, [{ type: 'directory', path: image }]),
    )
    // 未授权路径 → 拒绝
    expectPermissionDenied(() =>
      harness.controller.validateAttachments(sender, undefined, [{ type: 'image', path: outside }]),
    )
  })

  it('resolves a media file to its canonical path but rejects directories and unauthorized paths', async () => {
    const dir = join(tempRoot, 'media')
    const clip = join(dir, 'clip.mp4')
    const outside = join(tempRoot, 'outside.mp4')
    await mkdir(dir)
    await writeFile(clip, 'video')
    await writeFile(outside, 'video')
    const sender = new FakeSender()
    harness.dialogResult = { canceled: false, filePaths: [dir] }
    await harness.controller.openDirectory(sender, {})

    expect(harness.controller.resolveReadableFile(sender, clip)).toBe(await realpath(clip))
    // 目录不是常规文件 → 拒绝
    expectPermissionDenied(() => harness.controller.resolveReadableFile(sender, dir))
    // 未授权 → 拒绝
    expectPermissionDenied(() => harness.controller.resolveReadableFile(sender, outside))
  })
})
