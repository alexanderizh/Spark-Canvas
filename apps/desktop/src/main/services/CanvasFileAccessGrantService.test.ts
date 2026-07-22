import { mkdtemp, mkdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CanvasFileAccessGrantService,
  MAX_CANVAS_TEXT_FILE_BYTES,
  type CanvasFileAccessGrantSender,
} from './CanvasFileAccessGrantService.js'

class FakeSender implements CanvasFileAccessGrantSender {
  private readonly destroyedListeners: Array<() => void> = []

  once(event: 'destroyed', listener: () => void): void {
    if (event === 'destroyed') this.destroyedListeners.push(listener)
  }

  destroy(): void {
    const listeners = this.destroyedListeners.splice(0)
    for (const listener of listeners) listener()
  }

  destroyedListenerCount(): number {
    return this.destroyedListeners.length
  }
}

describe('CanvasFileAccessGrantService', () => {
  let tempRoot: string
  let service: CanvasFileAccessGrantService

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'spark-canvas-file-grant-'))
    service = new CanvasFileAccessGrantService()
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('exports the 2 MiB text file size boundary', () => {
    expect(MAX_CANVAS_TEXT_FILE_BYTES).toBe(2 * 1024 * 1024)
  })

  it('binds an exact selected file grant to the original sender', async () => {
    const selectedPath = join(tempRoot, 'selected.txt')
    const siblingPath = join(tempRoot, 'selected.txt.backup')
    await writeFile(selectedPath, 'selected')
    await writeFile(siblingPath, 'sibling')
    const sender = new FakeSender()
    const otherSender = new FakeSender()

    service.grantSelectedPaths(sender, [selectedPath])

    expect(service.isPathAllowed(sender, selectedPath)).toBe(true)
    expect(service.isPathAllowed(sender, siblingPath)).toBe(false)
    expect(service.isPathAllowed(otherSender, selectedPath)).toBe(false)
  })

  it('grants a selected directory and its canonical descendants only', async () => {
    const selectedDirectory = join(tempRoot, 'selected')
    const childPath = join(selectedDirectory, 'nested', 'file.txt')
    const prefixedDirectory = join(tempRoot, 'selected-copy')
    const prefixedPath = join(prefixedDirectory, 'file.txt')
    await mkdir(join(selectedDirectory, 'nested'), { recursive: true })
    await mkdir(prefixedDirectory)
    await writeFile(childPath, 'child')
    await writeFile(prefixedPath, 'prefixed')
    const sender = new FakeSender()

    service.grantSelectedPaths(sender, [selectedDirectory])

    expect(service.isPathAllowed(sender, selectedDirectory)).toBe(true)
    expect(service.isPathAllowed(sender, childPath)).toBe(true)
    expect(service.isPathAllowed(sender, prefixedPath)).toBe(false)
  })

  it('allows canonical project files but rejects a symlink escape', async () => {
    const projectRoot = join(tempRoot, 'project')
    const projectFile = join(projectRoot, 'notes.txt')
    const outsideFile = join(tempRoot, 'outside.txt')
    const escapePath = join(projectRoot, 'escape.txt')
    await mkdir(projectRoot)
    await writeFile(projectFile, 'inside')
    await writeFile(outsideFile, 'outside')
    await symlink(outsideFile, escapePath, 'file')
    const sender = new FakeSender()

    expect(service.isPathAllowed(sender, projectFile, projectRoot)).toBe(true)
    expect(service.isPathAllowed(sender, outsideFile, projectRoot)).toBe(false)
    expect(service.isPathAllowed(sender, escapePath, projectRoot)).toBe(false)
  })

  it('registers one destroyed listener and clears all sender grants on destruction', async () => {
    const firstPath = join(tempRoot, 'first.txt')
    const secondPath = join(tempRoot, 'second.txt')
    await writeFile(firstPath, 'first')
    await writeFile(secondPath, 'second')
    const sender = new FakeSender()

    service.grantSelectedPaths(sender, [firstPath])
    service.grantSelectedPaths(sender, [secondPath])

    expect(sender.destroyedListenerCount()).toBe(1)
    expect(service.isPathAllowed(sender, firstPath)).toBe(true)
    expect(service.isPathAllowed(sender, secondPath)).toBe(true)

    sender.destroy()

    expect(service.isPathAllowed(sender, firstPath)).toBe(false)
    expect(service.isPathAllowed(sender, secondPath)).toBe(false)
  })

  it('resolves allowed directories and media files to canonical readable paths', async () => {
    const selectedDirectory = join(tempRoot, 'selected')
    const mediaPath = join(selectedDirectory, 'clip.mp4')
    await mkdir(selectedDirectory)
    await writeFile(mediaPath, 'video')
    const sender = new FakeSender()
    service.grantSelectedPaths(sender, [selectedDirectory])

    expect(service.resolveReadablePath(sender, selectedDirectory)).toEqual({
      path: await realpath(selectedDirectory),
      kind: 'directory',
    })
    expect(service.resolveReadablePath(sender, mediaPath)).toEqual({
      path: await realpath(mediaPath),
      kind: 'file',
    })
  })

  it('rejects unauthorized readable paths and project-root symlink escapes', async () => {
    const projectRoot = join(tempRoot, 'project')
    const outsideFile = join(tempRoot, 'outside.mp4')
    const escapePath = join(projectRoot, 'escape.mp4')
    await mkdir(projectRoot)
    await writeFile(outsideFile, 'outside')
    await symlink(outsideFile, escapePath, 'file')
    const sender = new FakeSender()

    expect(() => service.resolveReadablePath(sender, outsideFile)).toThrow(/not allowed/i)
    expect(() => service.resolveReadablePath(sender, escapePath, projectRoot)).toThrow(
      /not allowed/i,
    )
  })

  it('resolves an allowed regular text file to its canonical path', async () => {
    const projectRoot = join(tempRoot, 'project')
    const filePath = join(projectRoot, 'notes.txt')
    await mkdir(projectRoot)
    await writeFile(filePath, 'hello')
    const sender = new FakeSender()

    expect(service.resolveReadableTextFile(sender, filePath, projectRoot)).toBe(
      await realpath(filePath),
    )
  })

  it('rejects unauthorized, missing, directory, and oversized text file reads', async () => {
    const allowedDirectory = join(tempRoot, 'allowed')
    const unauthorizedPath = join(tempRoot, 'unauthorized.txt')
    const missingPath = join(allowedDirectory, 'missing.txt')
    const oversizedPath = join(allowedDirectory, 'oversized.txt')
    await mkdir(allowedDirectory)
    await writeFile(unauthorizedPath, 'secret')
    await writeFile(oversizedPath, '')
    await truncate(oversizedPath, MAX_CANVAS_TEXT_FILE_BYTES + 1)
    const sender = new FakeSender()
    service.grantSelectedPaths(sender, [allowedDirectory])

    expect(() => service.resolveReadableTextFile(sender, unauthorizedPath)).toThrow(/not allowed/i)
    expect(() => service.resolveReadableTextFile(sender, missingPath)).toThrow(/regular file/i)
    expect(() => service.resolveReadableTextFile(sender, allowedDirectory)).toThrow(/regular file/i)
    expect(() => service.resolveReadableTextFile(sender, oversizedPath)).toThrow(/2 MiB/i)
  })
})
