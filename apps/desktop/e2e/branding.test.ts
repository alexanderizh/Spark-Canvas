import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

interface BuilderConfig {
  appId?: string
  productName?: string
  artifactName?: string
  protocols?: Array<{ name?: string; schemes?: string[] }>
  mac?: { category?: string; extendInfo?: { CFBundleDisplayName?: string } }
  nsis?: { shortcutName?: string; uninstallDisplayName?: string }
  linux?: { desktop?: { Name?: string } }
  publish?: { repo?: string; updaterCacheDirName?: string }
  extraResources?: Array<{ from?: string; to?: string; filter?: string[] }>
}

interface DevUpdateConfig {
  repo?: string
  updaterCacheDirName?: string
  releasesApiBase?: string
}

interface DesktopPackage {
  description?: string
  author?: string
}

describe('desktop branding boundaries', () => {
  it('uses the standalone Spark Canvas identity on every platform', () => {
    const config = load(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')) as BuilderConfig

    expect(config.appId).toBe('com.spark.canvas.desktop')
    expect(config.productName).toBe('Spark Canvas')
    expect(config.artifactName).toBe('${productName}-${version}-${os}-${arch}.${ext}')
    expect(config.protocols?.[0]?.schemes).toEqual(['spark-canvas'])

    expect(config.protocols?.[0]?.name).toBe('Spark Canvas redemption')
    expect(config.mac?.category).toBe('public.app-category.graphics-design')
    expect(config.mac?.extendInfo?.CFBundleDisplayName).toBe('Spark Canvas')
    expect(config.nsis?.shortcutName).toBe('Spark Canvas')
    expect(config.nsis?.uninstallDisplayName).toBe('Spark Canvas ${version}')
    expect(config.linux?.desktop?.Name).toBe('Spark Canvas')
    expect(config.publish?.repo).toBe('Spark-Canvas')
    expect(config.publish?.updaterCacheDirName).toBe('spark-canvas-updater')
    expect(
      config.extraResources?.find((entry) => entry.from === 'resources/skills')?.filter,
    ).toEqual([
      'canvas-studio/**/*',
      'multimedia-use/**/*',
      'video-workflow/**/*',
      'platform-manager/**/*',
    ])
  })

  it('uses Spark Canvas package metadata', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as DesktopPackage

    expect(pkg.description).toBe('Spark Canvas video workbench - Electron + React + TypeScript')
    expect(pkg.author).toBe('Spark Canvas Team')
  })

  it('uses Spark Canvas as the renderer window title', () => {
    const html = readFileSync(join(ROOT, 'src/renderer/index.html'), 'utf8')
    expect(html).toContain('<title>Spark Canvas</title>')
  })

  it('keeps development updates inside the Spark Canvas release namespace', () => {
    const config = load(readFileSync(join(ROOT, 'dev-app-update.yml'), 'utf8')) as DevUpdateConfig

    expect(config.repo).toBe('Spark-Canvas')
    expect(config.updaterCacheDirName).toBe('spark-canvas-dev-updater')
    expect(config.releasesApiBase).toBeUndefined()
  })
})
