import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronApp = vi.hoisted(() => ({
  getPath: vi.fn(() => '/tmp/spark-canvas-update-test'),
  getVersion: vi.fn(() => '1.0.0'),
  isPackaged: false,
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({ app: electronApp }))

import { UpdateService } from './UpdateService.js'

interface MutableUpdateService {
  releaseFeedConfig: {
    provider: 'github'
    owner: string
    repo: string
    updaterCacheDirName: string
    releasesApiBase: string
    versionCenterDownloadHosts: string[]
  }
  releaseAsset: {
    asset: {
      name: string
      browser_download_url: string
      size: number
      canvasIntegrity: {
        sha256: string
        sha512: string
        releaseManifestSha256: string
        signatureEvidenceDigest: string
      }
      canvasIdentity: {
        product: 'spark-canvas'
        appId: 'com.spark.canvas.desktop'
        channel: 'stable' | 'beta'
        platform: 'mac' | 'win' | 'linux'
        arch: 'arm64' | 'x64' | 'universal'
      }
    }
    source: 'version-center'
  } | null
  releaseInfo: {
    version: string
    releaseDate: string
    fileSize: number
  } | null
  status: ReturnType<UpdateService['getStatus']>
  downloadedFilePath: string | null
}

function configureVersionCenter(service: UpdateService): void {
  ;(service as unknown as MutableUpdateService).releaseFeedConfig = {
    provider: 'github',
    owner: 'alexanderizh',
    repo: 'Spark-Canvas',
    updaterCacheDirName: 'spark-canvas-updater',
    releasesApiBase: 'https://spark.example',
    versionCenterDownloadHosts: ['downloads.spark.example'],
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const matchingRelease = {
  schemaVersion: 2,
  product: 'spark-canvas',
  appId: 'com.spark.canvas.desktop',
  version: '1.0.0',
  channel: 'stable',
  platform: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux',
  arch: process.arch === 'arm64' ? 'arm64' : 'x64',
  fileName: 'Spark Canvas-1.0.0-test.bin',
  fileSize: 123,
  sha256: 'a'.repeat(64),
  sha512: 'b'.repeat(128),
  publicUrl: 'https://downloads.spark.example/spark-canvas/stable/1.0.0/app.bin',
  releaseManifestSha256: 'c'.repeat(64),
  signatureEvidenceDigest: 'd'.repeat(64),
  releaseNotes: null,
  publishedAt: '2026-07-19T12:00:00.000Z',
}

describe('UpdateService v2 version-center fallback boundary', () => {
  let userDataPath: string

  beforeEach(() => {
    vi.restoreAllMocks()
    userDataPath = mkdtempSync(`${tmpdir()}/spark-canvas-update-service-`)
    electronApp.getPath.mockReturnValue(userDataPath)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('falls back to the Spark Canvas GitHub feed only after a transport failure', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(
        jsonResponse({
          tag_name: '1.0.0',
          prerelease: false,
          draft: false,
          body: null,
          published_at: '2026-07-19T12:00:00.000Z',
          assets: [],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new UpdateService()
    configureVersionCenter(service)

    const status = await service.checkForUpdates()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v2/desktop/releases/latest')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('product=spark-canvas')
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.github.com/repos/alexanderizh/Spark-Canvas/releases/latest',
    )
    expect(status.state).toBe('not-available')
    expect(status.updateSource).toBe('github')
  })

  it('treats a matching v2 data:null response as no update without GitHub fallback', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ code: 0, data: null }))
    vi.stubGlobal('fetch', fetchMock)
    const service = new UpdateService()
    configureVersionCenter(service)

    const status = await service.checkForUpdates()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(status.state).toBe('not-available')
    expect(status.error).toBeNull()
  })

  it('fails closed on a product identity mismatch without GitHub fallback', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ code: 0, data: { ...matchingRelease, product: 'spark-agent' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const service = new UpdateService()
    configureVersionCenter(service)

    const status = await service.checkForUpdates()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(status.state).toBe('error')
    expect(status.error).toContain('product mismatch')
  })

  it('fails closed on version-center HTTP 4xx without GitHub fallback', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ code: 1, message: 'invalid product' }, 422))
    vi.stubGlobal('fetch', fetchMock)
    const service = new UpdateService()
    configureVersionCenter(service)

    const status = await service.checkForUpdates()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(status.state).toBe('error')
    expect(status.error).toContain('422')
  })

  it('does not mark a v2 download complete when its approved digests do not match', async () => {
    const approvedBytes = Buffer.from('approved Spark Canvas installer')
    const downloadedBytes = Buffer.from('tampered Spark Canvas installer')
    const service = new UpdateService()
    configureVersionCenter(service)
    const mutable = service as unknown as MutableUpdateService
    const releaseInfo = {
      version: '1.2.3',
      releaseDate: '2026-07-19T12:00:00.000Z',
      fileSize: approvedBytes.byteLength,
    }
    mutable.releaseAsset = {
      source: 'version-center',
      asset: {
        name: 'Spark Canvas-1.2.3-mac-arm64.dmg',
        browser_download_url: 'https://downloads.spark.example/app.dmg',
        size: approvedBytes.byteLength,
        canvasIntegrity: {
          sha256: createHash('sha256').update(approvedBytes).digest('hex'),
          sha512: createHash('sha512').update(approvedBytes).digest('base64'),
          releaseManifestSha256: 'c'.repeat(64),
          signatureEvidenceDigest: 'd'.repeat(64),
        },
        canvasIdentity: {
          product: 'spark-canvas',
          appId: 'com.spark.canvas.desktop',
          channel: 'stable',
          platform: 'mac',
          arch: 'arm64',
        },
      },
    }
    mutable.releaseInfo = releaseInfo
    mutable.status = {
      ...service.getStatus(),
      state: 'available',
      updateInfo: releaseInfo,
      updateSource: 'version-center',
      downloadSource: 'version-center',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(downloadedBytes, {
          status: 200,
          headers: { 'content-length': String(downloadedBytes.byteLength) },
        }),
      ),
    )

    await expect(service.downloadUpdate()).resolves.toBe(false)
    expect(service.getStatus().state).toBe('error')
    expect(service.getStatus().error).toMatch(/size mismatch|SHA-256 mismatch/)
  })

  it('stores a verified v2 artifact inside the full Spark Canvas cache partition', async () => {
    const bytes = Buffer.from('verified Spark Canvas installer')
    const service = new UpdateService()
    configureVersionCenter(service)
    const mutable = service as unknown as MutableUpdateService
    const releaseInfo = {
      version: '1.2.3',
      releaseDate: '2026-07-19T12:00:00.000Z',
      fileSize: bytes.byteLength,
    }
    mutable.releaseAsset = {
      source: 'version-center',
      asset: {
        name: 'Spark Canvas-1.2.3-mac-arm64.dmg',
        browser_download_url: 'https://downloads.spark.example/app.dmg',
        size: bytes.byteLength,
        canvasIntegrity: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sha512: createHash('sha512').update(bytes).digest('base64'),
          releaseManifestSha256: 'c'.repeat(64),
          signatureEvidenceDigest: 'd'.repeat(64),
        },
        canvasIdentity: {
          product: 'spark-canvas',
          appId: 'com.spark.canvas.desktop',
          channel: 'stable',
          platform: 'mac',
          arch: 'arm64',
        },
      },
    }
    mutable.releaseInfo = releaseInfo
    mutable.status = {
      ...service.getStatus(),
      state: 'available',
      updateInfo: releaseInfo,
      updateSource: 'version-center',
      downloadSource: 'version-center',
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(service.downloadUpdate()).resolves.toBe(true)
    expect(mutable.downloadedFilePath).toBe(
      join(
        userDataPath,
        'spark-canvas-updater',
        'spark-canvas',
        'stable',
        'mac-arm64',
        '1.2.3',
        'Spark Canvas-1.2.3-mac-arm64.dmg',
      ),
    )
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })
})
