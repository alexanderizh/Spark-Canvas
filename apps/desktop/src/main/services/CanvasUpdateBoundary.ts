import { APP_BUNDLE_ID, APP_ID } from '@spark/shared'

export const CANVAS_UPDATE_PRODUCT = APP_ID
export const CANVAS_UPDATE_APP_ID = APP_BUNDLE_ID
export const CANVAS_UPDATE_SCHEMA_VERSION = 2 as const

export type CanvasUpdatePlatform = 'mac' | 'win' | 'linux'
export type CanvasUpdateArch = 'arm64' | 'x64' | 'universal'

export interface CanvasVersionCenterTarget {
  product: typeof CANVAS_UPDATE_PRODUCT
  appId: typeof CANVAS_UPDATE_APP_ID
  channel: 'stable' | 'beta'
  platform: CanvasUpdatePlatform
  arch: CanvasUpdateArch
  allowedDownloadHosts: readonly string[]
}

export interface CanvasVersionCenterRelease {
  schemaVersion: typeof CANVAS_UPDATE_SCHEMA_VERSION
  product: typeof CANVAS_UPDATE_PRODUCT
  appId: typeof CANVAS_UPDATE_APP_ID
  version: string
  channel: CanvasVersionCenterTarget['channel']
  platform: CanvasUpdatePlatform
  arch: CanvasUpdateArch
  fileName: string
  fileSize: number
  sha256: string
  sha512: string
  publicUrl: string
  releaseManifestSha256: string
  signatureEvidenceDigest: string
  releaseNotes: string | null
  publishedAt: string | null
}

export class CanvasUpdateBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanvasUpdateBoundaryError'
  }
}

function boundaryError(message: string): never {
  throw new CanvasUpdateBoundaryError(`Spark Canvas v2 update rejected: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    return boundaryError(`${key} is missing`)
  }
  return value.trim()
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value == null) return null
  if (typeof value !== 'string') return boundaryError(`${key} must be a string or null`)
  return value
}

function isEncodedDigest(value: string, byteLength: number): boolean {
  if (new RegExp(`^[a-fA-F0-9]{${byteLength * 2}}$`).test(value)) return true
  const base64Length = Math.ceil(byteLength / 3) * 4
  return (
    value.length === base64Length &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
    Buffer.from(value, 'base64').byteLength === byteLength
  )
}

function readDigest(record: Record<string, unknown>, key: string, byteLength: number): string {
  const value = readString(record, key)
  if (!isEncodedDigest(value, byteLength)) {
    return boundaryError(`${key} is not a valid ${byteLength * 8}-bit digest`)
  }
  return value
}

function validateDownloadUrl(value: string, allowedHosts: readonly string[]): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return boundaryError('publicUrl is invalid')
  }
  if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) {
    return boundaryError('publicUrl must be credential-free HTTPS')
  }
  const allowed = new Set(allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean))
  if (!allowed.has(url.hostname.toLowerCase())) {
    return boundaryError(`publicUrl host is not approved: ${url.hostname}`)
  }
  return url.toString()
}

export function buildCanvasVersionCenterLatestUrl(
  base: string,
  target: CanvasVersionCenterTarget,
): URL {
  const url = new URL('/api/v2/desktop/releases/latest', base)
  if (url.protocol !== 'https:') return boundaryError('version center must use HTTPS')
  url.searchParams.set('product', target.product)
  url.searchParams.set('appId', target.appId)
  url.searchParams.set('channel', target.channel)
  url.searchParams.set('platform', target.platform)
  url.searchParams.set('arch', target.arch)
  return url
}

export function parseCanvasVersionCenterResponse(
  value: unknown,
  target: CanvasVersionCenterTarget,
): CanvasVersionCenterRelease | null {
  if (!isRecord(value) || value.code !== 0 || !Object.hasOwn(value, 'data')) {
    return boundaryError('response envelope is invalid')
  }
  if (value.data == null) return null
  if (!isRecord(value.data)) return boundaryError('data must be an object or null')

  const data = value.data
  if (data.schemaVersion !== CANVAS_UPDATE_SCHEMA_VERSION) {
    return boundaryError('schemaVersion must be 2')
  }

  const product = readString(data, 'product')
  const appId = readString(data, 'appId')
  const channel = readString(data, 'channel')
  const platform = readString(data, 'platform')
  const arch = readString(data, 'arch')
  if (product !== target.product) return boundaryError(`product mismatch: ${product}`)
  if (appId !== target.appId) return boundaryError(`appId mismatch: ${appId}`)
  if (channel !== target.channel) return boundaryError(`channel mismatch: ${channel}`)
  if (platform !== target.platform) return boundaryError(`platform mismatch: ${platform}`)
  if (arch !== target.arch) return boundaryError(`arch mismatch: ${arch}`)

  const version = readString(data, 'version')
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version,
    )
  ) {
    return boundaryError('version must be semantic versioning')
  }

  const fileName = readString(data, 'fileName')
  if (fileName === '.' || fileName === '..' || /[/\\]/.test(fileName)) {
    return boundaryError('fileName must be a plain file name')
  }
  if (!fileName.startsWith(`Spark Canvas-${version}-`)) {
    return boundaryError('fileName does not belong to Spark Canvas')
  }
  const fileSize = data.fileSize
  if (!Number.isSafeInteger(fileSize) || (fileSize as number) <= 0) {
    return boundaryError('fileSize must be a positive safe integer')
  }

  const publishedAt = readNullableString(data, 'publishedAt')
  if (publishedAt != null && !Number.isFinite(Date.parse(publishedAt))) {
    return boundaryError('publishedAt is invalid')
  }

  return {
    schemaVersion: CANVAS_UPDATE_SCHEMA_VERSION,
    product: CANVAS_UPDATE_PRODUCT,
    appId: CANVAS_UPDATE_APP_ID,
    version,
    channel: target.channel,
    platform: target.platform,
    arch: target.arch,
    fileName,
    fileSize: fileSize as number,
    sha256: readDigest(data, 'sha256', 32),
    sha512: readDigest(data, 'sha512', 64),
    publicUrl: validateDownloadUrl(readString(data, 'publicUrl'), target.allowedDownloadHosts),
    releaseManifestSha256: readDigest(data, 'releaseManifestSha256', 32),
    signatureEvidenceDigest: readDigest(data, 'signatureEvidenceDigest', 32),
    releaseNotes: readNullableString(data, 'releaseNotes'),
    publishedAt,
  }
}
