import { describe, expect, it } from 'vitest'
import {
  CanvasUpdateBoundaryError,
  buildCanvasVersionCenterLatestUrl,
  parseCanvasVersionCenterResponse,
} from './CanvasUpdateBoundary.js'

const expectedTarget = {
  product: 'spark-canvas' as const,
  appId: 'com.spark.canvas.desktop' as const,
  channel: 'stable' as const,
  platform: 'mac' as const,
  arch: 'arm64' as const,
  allowedDownloadHosts: ['downloads.spark.example'],
}

const release = {
  schemaVersion: 2,
  product: 'spark-canvas',
  appId: 'com.spark.canvas.desktop',
  version: '1.2.3',
  channel: 'stable',
  platform: 'mac',
  arch: 'arm64',
  fileName: 'Spark Canvas-1.2.3-mac-arm64.dmg',
  fileSize: 123,
  sha256: 'a'.repeat(64),
  sha512: 'b'.repeat(128),
  publicUrl: 'https://downloads.spark.example/spark-canvas/stable/1.2.3/app.dmg',
  releaseManifestSha256: 'c'.repeat(64),
  signatureEvidenceDigest: 'd'.repeat(64),
  releaseNotes: 'Canvas update',
  publishedAt: '2026-07-19T12:00:00.000Z',
}

describe('Spark Canvas v2 update boundary', () => {
  it('builds only the product-partitioned v2 latest URL', () => {
    const url = buildCanvasVersionCenterLatestUrl('https://spark.example/root', expectedTarget)

    expect(url.origin).toBe('https://spark.example')
    expect(url.pathname).toBe('/api/v2/desktop/releases/latest')
    expect(url.searchParams.get('product')).toBe('spark-canvas')
    expect(url.searchParams.get('appId')).toBe('com.spark.canvas.desktop')
    expect(url.searchParams.get('channel')).toBe('stable')
    expect(url.searchParams.get('platform')).toBe('mac')
    expect(url.searchParams.get('arch')).toBe('arm64')
  })

  it('accepts only a complete release matching the requested product target', () => {
    expect(parseCanvasVersionCenterResponse({ code: 0, data: release }, expectedTarget)).toEqual(
      release,
    )
    expect(parseCanvasVersionCenterResponse({ code: 0, data: null }, expectedTarget)).toBeNull()
  })

  it.each([
    ['schemaVersion', 1],
    ['product', 'spark-agent'],
    ['appId', 'com.spark-agent.desktop'],
    ['channel', 'beta'],
    ['platform', 'win'],
    ['arch', 'x64'],
  ] as const)('fails closed when %s does not match', (key, value) => {
    expect(() =>
      parseCanvasVersionCenterResponse(
        { code: 0, data: { ...release, [key]: value } },
        expectedTarget,
      ),
    ).toThrow(CanvasUpdateBoundaryError)
  })

  it.each([
    ['version', '../1.2.3'],
    ['fileName', '../Spark Canvas-1.2.3-mac-arm64.dmg'],
    ['fileName', 'Spark Agent-1.2.3-mac-arm64.dmg'],
    ['sha256', 'missing'],
    ['sha512', 'missing'],
    ['fileSize', 0],
    ['publicUrl', 'http://downloads.spark.example/app.dmg'],
    ['publicUrl', 'https://unapproved.example/app.dmg'],
    ['releaseManifestSha256', 'missing'],
    ['signatureEvidenceDigest', ''],
    ['publishedAt', 'not-a-date'],
  ] as const)('rejects invalid or incomplete artifact field %s', (key, value) => {
    expect(() =>
      parseCanvasVersionCenterResponse(
        { code: 0, data: { ...release, [key]: value } },
        expectedTarget,
      ),
    ).toThrow(CanvasUpdateBoundaryError)
  })

  it('rejects malformed envelopes instead of treating them as no update', () => {
    expect(() =>
      parseCanvasVersionCenterResponse({ code: 1, message: 'invalid product' }, expectedTarget),
    ).toThrow(CanvasUpdateBoundaryError)
    expect(() => parseCanvasVersionCenterResponse({}, expectedTarget)).toThrow(
      CanvasUpdateBoundaryError,
    )
  })
})
