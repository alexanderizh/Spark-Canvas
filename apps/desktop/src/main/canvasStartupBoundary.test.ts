import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const ipcSource = readFileSync(join(__dirname, 'ipc/index.ts'), 'utf8')

function functionBody(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) throw new Error(`Unable to isolate ${startMarker}`)
  return source.slice(start, end)
}

function ipcHandlerBody(channel: string, nextChannel: string): string {
  const startMarker = `typedIpcHandle('${channel}'`
  const endMarker = `typedIpcHandle('${nextChannel}'`
  const start = ipcSource.indexOf(startMarker)
  const end = ipcSource.indexOf(endMarker, start + startMarker.length)
  if (start < 0 || end < 0) throw new Error(`Unable to isolate ${channel}`)
  return ipcSource.slice(start, end)
}

describe('Spark Canvas startup boundary', () => {
  it('keeps a single registered main window as the trusted Canvas shell', () => {
    const showMainWindow = functionBody('function showMainWindow()', 'const pendingRedeemCodes')
    const createWindow = functionBody(
      'function createWindow()',
      '/**\n * 初始化主进程核心服务',
    )

    expect(showMainWindow).toContain('getMainWindow()')
    expect(showMainWindow).not.toContain('BrowserWindow.getAllWindows()[0]')
    expect(createWindow).toContain('const existing = getMainWindow()')
    expect(createWindow).toContain('if (existing != null && !existing.isDestroyed()) return existing')
  })

  it('does not start old platform background runtimes during application boot', () => {
    const initializeApp = functionBody(
      'async function initializeApp()',
      'log.info(`${PRODUCT_IDENTITY.name} initialized`)',
    )

    expect(initializeApp).not.toContain('startScheduler()')
    expect(initializeApp).not.toContain('ensurePlaywrightRegistered(')
    expect(initializeApp).not.toContain('startAllEnabled()')
    expect(initializeApp).not.toContain('autoInstallBrowser(')
    expect(initializeApp).not.toContain('initializeAppSkills()')
    expect(initializeApp).toContain('initializeCanvasSkillsMetadata(')
    expect(ipcSource).not.toContain('.startRuntime(handleRemoteInboundMessage)')
  })

  it('initializes the BYOK credential vault before IPC and Cloud Auth startup', () => {
    const initializeApp = functionBody(
      'async function initializeApp()',
      'log.info(`${PRODUCT_IDENTITY.name} initialized`)',
    )
    const credentialVault = initializeApp.indexOf('await initializeCredentialVault()')
    const ipc = initializeApp.indexOf('registerAllIpcHandlers()')
    const cloudAuth = initializeApp.indexOf('initAuthService(')

    expect(credentialVault).toBeGreaterThanOrEqual(0)
    expect(credentialVault).toBeLessThan(ipc)
    expect(credentialVault).toBeLessThan(cloudAuth)
  })

  it('keeps the tray focused on the Canvas product instead of old sessions', () => {
    const tray = functionBody('function createTray()', 'function createWindow()')

    expect(tray).not.toContain('getRecentSessionsForTray(')
    expect(tray).not.toContain('新建会话')
    expect(tray).not.toContain('最近会话')
    expect(tray).toContain('PRODUCT_IDENTITY.name')
  })

  it('reads Canvas Agent session history without constructing SessionService', () => {
    const history = ipcHandlerBody('session:get-history', 'session:list')
    const list = ipcHandlerBody('session:list', 'session:search')

    expect(history).toContain('SessionReadService')
    expect(history).not.toContain('getSessionService()')
    expect(list).toContain('SessionReadService')
    expect(list).not.toContain('getSessionService()')
  })

  it('keeps skill:list read-only and inside the Canvas runtime allowlist', () => {
    const listSkills = ipcHandlerBody('skill:list', 'skill:create')

    expect(listSkills).toContain('filterCanvasRuntimeSkills(')
    expect(listSkills).not.toContain('ensureBuiltInSkills()')
    expect(listSkills).not.toContain('rebuildManagedSkillsPlugin()')
  })

  it('keeps FFmpeg installation outside the old Skill Registry boundary', () => {
    const start = ipcSource.indexOf("typedIpcHandle('ffmpeg:install'")
    const end = ipcSource.indexOf('/** 通用视频处理 handler', start)
    if (start < 0 || end < 0) throw new Error('Unable to isolate ffmpeg:install')
    const install = ipcSource.slice(start, end)

    expect(install).toContain('installCanvasFfmpeg')
    expect(install).not.toContain('getSkillRegistryService()')
    expect(install).not.toContain("typedIpcHandle('binary:install'")
    expect(ipcSource).not.toContain("typedIpcHandle('binary:install'")
  })
})
