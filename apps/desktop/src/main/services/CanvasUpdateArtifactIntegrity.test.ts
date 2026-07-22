import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CanvasUpdateArtifactError,
  verifyCanvasUpdateArtifact,
} from './CanvasUpdateArtifactIntegrity.js'

describe('Spark Canvas update artifact integrity', () => {
  let root: string
  let artifactPath: string
  const bytes = Buffer.from('spark-canvas-update-artifact')

  beforeEach(() => {
    root = join(
      tmpdir(),
      `spark-canvas-update-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(root, { recursive: true })
    artifactPath = join(root, 'Spark Canvas-1.2.3-mac-arm64.dmg')
    writeFileSync(artifactPath, bytes)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('accepts a regular file matching size and both approved digests', async () => {
    await expect(
      verifyCanvasUpdateArtifact(artifactPath, {
        fileSize: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sha512: createHash('sha512').update(bytes).digest('base64'),
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects a truncated artifact before it can be reused from cache', async () => {
    await expect(
      verifyCanvasUpdateArtifact(artifactPath, {
        fileSize: bytes.byteLength + 1,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sha512: createHash('sha512').update(bytes).digest('base64'),
      }),
    ).rejects.toThrow(CanvasUpdateArtifactError)
  })

  it('rejects an artifact whose bytes were replaced without changing its size', async () => {
    const replaced = Buffer.from(bytes.map((byte) => byte ^ 1))
    writeFileSync(artifactPath, replaced)

    await expect(
      verifyCanvasUpdateArtifact(artifactPath, {
        fileSize: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sha512: createHash('sha512').update(bytes).digest('base64'),
      }),
    ).rejects.toThrow('SHA-256 mismatch')
  })
})
