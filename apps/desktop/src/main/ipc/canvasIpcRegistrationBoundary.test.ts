import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANVAS_INVOKE_CHANNELS } from '../../shared/canvasIpcPolicy.js'

const desktopRoot = resolve(__dirname, '../../..')
const ipcSource = readFileSync(resolve(desktopRoot, 'src/main/ipc/index.ts'), 'utf8')
const authSource = readFileSync(
  resolve(desktopRoot, 'src/main/services/Auth/registerAuthIpc.ts'),
  'utf8',
)
const platformModelSource = readFileSync(
  resolve(desktopRoot, 'src/main/services/PlatformModel/registerPlatformModelIpc.ts'),
  'utf8',
)
const canvasAgentWorkspaceSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/canvasAgentWorkspace.ts'),
  'utf8',
)
const canvasAgentSessionSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/canvasAgentSession.ts'),
  'utf8',
)
const canvasFileAccessIpcSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/registerCanvasFileAccessIpc.ts'),
  'utf8',
)
const providerFilesIpcSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/registerProviderFilesIpc.ts'),
  'utf8',
)
const canvasTextTaskIpcSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/registerCanvasTextTaskIpc.ts'),
  'utf8',
)
const canvasAnnotationIpcSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/registerCanvasAnnotationIpc.ts'),
  'utf8',
)
const sessionStreamRoutingSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/sessionStreamRouting.ts'),
  'utf8',
)
const sessionStreamPublisherSource = readFileSync(
  resolve(desktopRoot, 'src/main/ipc/sessionStreamPublisher.ts'),
  'utf8',
)

function collectTypedRegistrations(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/typedIpcHandle\s*\(\s*['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .filter((channel): channel is string => channel != null),
  )
}

function listProductionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listProductionTypeScriptFiles(path)
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return []
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) return []
    return [path]
  })
}

describe('Canvas IPC registration boundary', () => {
  it('has a main-process handler for every allowed invoke channel', () => {
    const registered = new Set([
      ...collectTypedRegistrations(ipcSource),
      ...collectTypedRegistrations(authSource),
      ...collectTypedRegistrations(platformModelSource),
      ...collectTypedRegistrations(canvasAgentWorkspaceSource),
      ...collectTypedRegistrations(canvasAgentSessionSource),
      ...collectTypedRegistrations(canvasFileAccessIpcSource),
      ...collectTypedRegistrations(providerFilesIpcSource),
      ...collectTypedRegistrations(canvasTextTaskIpcSource),
      ...collectTypedRegistrations(canvasAnnotationIpcSource),
    ])

    expect(CANVAS_INVOKE_CHANNELS.filter((channel) => !registered.has(channel))).toEqual([])
  })

  it('keeps the native dropped-file grant private to the preload bridge', () => {
    expect(canvasFileAccessIpcSource).toContain(
      "typedPrivateIpcHandle('canvas:file:grant-dropped-paths'",
    )
    expect(CANVAS_INVOKE_CHANNELS).not.toContain('canvas:file:grant-dropped-paths')
  })

  it('binds Provider Files uploads and annotation saves to the requesting Canvas sender', () => {
    expect(providerFilesIpcSource).toMatch(
      /provider:files:upload[\s\S]{0,1200}resolveReadableFile\([\s\S]{0,300}event\.sender/,
    )
    expect(canvasAnnotationIpcSource).toMatch(
      /file:save-canvas-annotation[\s\S]{0,1800}resolveTrustedProjectRoot\(event\.sender\)/,
    )
    expect(canvasAnnotationIpcSource).toContain(
      "resolveContainedDirectory(canonicalProjectRoot, 'assets')",
    )
    expect(canvasAnnotationIpcSource).toMatch(
      /resolveContainedDirectory[\s\S]{0,500}fs\.realpath\(expectedPath\)[\s\S]{0,700}fs\.mkdir\(expectedPath\)/,
    )
    expect(authSource).toMatch(
      /auth:upload-file[\s\S]{0,700}resolveReadableFile\(event\.sender, req\.filePath\)/,
    )
    expect(ipcSource).toMatch(
      /registerAuthIpc\([\s\S]{0,700}canvasFileAccess\.resolveReadableFile\(/,
    )
  })

  it('binds Canvas text tasks to the active project window', () => {
    expect(canvasTextTaskIpcSource).toContain(
      'await dependencies.authorizeProject(event.sender, req.projectId)',
    )
    expect(ipcSource).toMatch(
      /authorizeProject:[\s\S]{0,900}windowService\.getWindow\(\)\?\.webContents\s*===\s*sender/,
    )
    expect(canvasTextTaskIpcSource).toContain('workspaceId: projectContext.workspaceId')
    expect(canvasTextTaskIpcSource).toContain('.cancelSessionExecution(sessionId)')
    expect(canvasTextTaskIpcSource).not.toContain('.cancelTurn(sessionId)')
    expect(canvasTextTaskIpcSource).not.toContain("'claude-bypass'")
    expect(canvasTextTaskIpcSource).not.toContain("'codex-full-access'")
    expect(canvasTextTaskIpcSource).toContain("event.sender.send('stream:canvas:text-task'")
  })

  it('keeps Canvas media validation, results, and cancellation on the owning window', () => {
    expect(ipcSource).not.toMatch(
      /canvas:task:create-media[\s\S]{0,9000}skipValidation:\s*true/,
    )
    expect(ipcSource).toContain("taskOwner.send('stream:canvas:media-task'")
    expect(ipcSource).toContain('canvasMediaTaskOwners.requireOwner(')
  })

  it('does not register the generic rootPath workspace opener', () => {
    expect(ipcSource).not.toMatch(/typedIpcHandle\s*\(\s*['"]workspace:open['"]/)
    expect(canvasAgentWorkspaceSource).toMatch(
      /typedIpcHandle\s*\(\s*['"]canvas:agent:open-workspace['"]/,
    )
  })

  it('does not enter the Terminal or GitHub Connector registration modules', () => {
    expect(ipcSource).not.toContain('import { registerTerminalIpc }')
    expect(ipcSource).not.toContain('registerTerminalIpc()')
    expect(ipcSource).not.toContain('import { registerGitHubConnectorIpc }')
    expect(ipcSource).not.toContain('registerGitHubConnectorIpc()')
  })

  it('binds Canvas host operations to the authorized renderer sender', () => {
    expect(ipcSource).toMatch(
      /const canvasAgentSessionFacade\s*=\s*registerCanvasAgentSessionIpc\(/,
    )
    expect(ipcSource).toMatch(
      /canvas:host-attach[\s\S]{0,900}authorizeSessionAccess\(\s*req\.sessionId,\s*event\.sender,?\s*\)/,
    )
    expect(ipcSource).toMatch(
      /canvas:host-attach[\s\S]{0,1200}context\.projectId\s*!==\s*req\.projectId/,
    )
    expect(ipcSource).toMatch(
      /canvas:host-detach[\s\S]{0,500}detach\(req\.sessionId,\s*event\.sender\)/,
    )
    expect(ipcSource).toMatch(/canvas:tool-result[\s\S]{0,900}event\.sender/)
    expect(ipcSource).toMatch(
      /canvas:tool-ack[\s\S]{0,500}handleToolAck\(req\.requestId,\s*event\.sender\)/,
    )
  })

  it('routes Canvas session events without broadcasting them to other windows', () => {
    expect(sessionStreamRoutingSource).toContain("if (surface === 'canvas')")
    expect(sessionStreamPublisherSource).toContain('routeSessionStreamEvent(')
    expect(ipcSource).toContain("from './sessionStreamPublisher.js'")
    expect(ipcSource).toMatch(
      /const onEvent:[\s\S]{0,500}pushSessionStreamEvent\('stream:session:agent-event'/,
    )
    expect(ipcSource).toMatch(
      /const onSessionRenamed:[\s\S]{0,500}pushSessionStreamEvent\('stream:session:renamed'/,
    )
    expect(canvasAgentSessionSource).not.toContain('onSessionCreated')
  })

  it('keeps typed-ipc as the only native ipcMain registration point', () => {
    const mainRoot = resolve(desktopRoot, 'src/main')
    const typedIpcPath = resolve(mainRoot, 'ipc/typed-ipc.ts')
    const nativeRegistration = /\bipcMain\s*(?:\.|\[['"])(?:handle|on|once)\b/
    const bypasses = listProductionTypeScriptFiles(mainRoot)
      .filter((path) => path !== typedIpcPath)
      .filter((path) => nativeRegistration.test(readFileSync(path, 'utf8')))
      .map((path) => relative(desktopRoot, path))

    expect(bypasses).toEqual([])
  })
})
