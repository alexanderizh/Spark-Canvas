import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export interface CanvasUpdateArtifactIntegrity {
  fileSize: number
  sha256: string
  sha512: string
}

export class CanvasUpdateArtifactError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanvasUpdateArtifactError'
  }
}

function digestMatches(hash: ReturnType<typeof createHash>, expected: string): boolean {
  const hex = hash.copy().digest('hex')
  if (/^[a-fA-F0-9]+$/.test(expected)) return hex === expected.toLowerCase()
  return hash.digest('base64') === expected
}

export async function verifyCanvasUpdateArtifact(
  filePath: string,
  expected: CanvasUpdateArtifactIntegrity,
): Promise<void> {
  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch (error) {
    throw new CanvasUpdateArtifactError('update artifact is missing', { cause: error })
  }
  if (!fileStat.isFile()) {
    throw new CanvasUpdateArtifactError('update artifact is not a regular file')
  }
  if (fileStat.size !== expected.fileSize) {
    throw new CanvasUpdateArtifactError(
      `update artifact size mismatch: expected ${expected.fileSize}, received ${fileStat.size}`,
    )
  }

  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk: string | Buffer) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      sha256.update(bytes)
      sha512.update(bytes)
    })
    stream.on('error', reject)
    stream.on('end', resolve)
  }).catch((error: unknown) => {
    throw new CanvasUpdateArtifactError('failed to read update artifact', { cause: error })
  })

  if (!digestMatches(sha256, expected.sha256)) {
    throw new CanvasUpdateArtifactError('update artifact SHA-256 mismatch')
  }
  if (!digestMatches(sha512, expected.sha512)) {
    throw new CanvasUpdateArtifactError('update artifact SHA-512 mismatch')
  }
}
