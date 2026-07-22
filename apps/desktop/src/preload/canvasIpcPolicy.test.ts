import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  getPathForFile: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  webUtils: { getPathForFile: mocks.getPathForFile },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    off: mocks.off,
  },
}))

type ExposedSparkApi = {
  invoke: (channel: string, request: unknown) => Promise<unknown>
  on: (channel: string, callback: (payload: unknown) => void) => () => void
  grantDroppedFiles: (files: readonly File[]) => Promise<Array<string | null>>
}

let sparkApi: ExposedSparkApi

describe('preload Canvas IPC boundary', () => {
  beforeAll(async () => {
    await import('./index.js')
    sparkApi = mocks.exposeInMainWorld.mock.calls[0]?.[1] as ExposedSparkApi
  })

  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.getPathForFile.mockReset()
    mocks.on.mockReset()
    mocks.off.mockReset()
  })

  it('rejects a legacy invoke before it reaches Electron', async () => {
    await expect(
      sparkApi.invoke('workspace:open', { rootPath: '/tmp/injected' }),
    ).rejects.toMatchObject({
      code: 'IPC_CHANNEL_NOT_ALLOWED',
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('forwards an allowed Canvas invoke', async () => {
    mocks.invoke.mockResolvedValue({ ok: true, data: { workspaceId: 'workspace-1' } })

    await expect(
      sparkApi.invoke('canvas:agent:open-workspace', { projectId: 'project-1' }),
    ).resolves.toEqual({ workspaceId: 'workspace-1' })
    expect(mocks.invoke).toHaveBeenCalledWith('canvas:agent:open-workspace', {
      projectId: 'project-1',
    })
  })

  it('extracts native paths from real dropped Files before invoking the private grant channel', async () => {
    const video = { name: 'clip.mp4' } as File
    const synthetic = { name: 'memory.mp4' } as File
    mocks.getPathForFile.mockImplementation((file: File) =>
      file === video ? '/drop/clip.mp4' : '',
    )
    mocks.invoke.mockResolvedValue({
      ok: true,
      data: { paths: ['/canonical/clip.mp4'] },
    })

    await expect(sparkApi.grantDroppedFiles([video, synthetic])).resolves.toEqual([
      '/canonical/clip.mp4',
      null,
    ])
    expect(mocks.invoke).toHaveBeenCalledWith('canvas:file:grant-dropped-paths', {
      paths: ['/drop/clip.mp4'],
    })
  })

  it('rejects a legacy stream before it reaches Electron', () => {
    expect(() => sparkApi.on('stream:terminal:event', vi.fn())).toThrowError(
      expect.objectContaining({ code: 'IPC_CHANNEL_NOT_ALLOWED' }),
    )
    expect(mocks.on).not.toHaveBeenCalled()
  })

  it('subscribes and unsubscribes an allowed Canvas stream', () => {
    const unsubscribe = sparkApi.on('stream:canvas:media-task', vi.fn())

    expect(mocks.on).toHaveBeenCalledWith('stream:canvas:media-task', expect.any(Function))
    unsubscribe()
    expect(mocks.off).toHaveBeenCalledWith('stream:canvas:media-task', expect.any(Function))
  })
})
