import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: mocks.handle,
    removeHandler: mocks.removeHandler,
  },
}))

vi.mock('@spark/shared', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isSparkError: () => false,
}))

vi.mock('../windows/index.js', () => ({
  broadcastToAppWindows: vi.fn(),
}))

vi.mock('./ipc-performance.js', () => ({
  ipcPerformanceTracker: {
    record: vi.fn(() => ({ slow: false, report: null, durationMs: 0, budgetMs: 0 })),
  },
}))

import { typedIpcHandle, typedPrivateIpcHandle } from './typed-ipc.js'

describe('typedIpcHandle Canvas registration policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not register a legacy platform handler', () => {
    typedIpcHandle('workspace:open', vi.fn() as never)

    expect(mocks.removeHandler).toHaveBeenCalledWith('workspace:open')
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it('registers a Canvas workbench handler', () => {
    typedIpcHandle('canvas:agent:open-workspace', vi.fn() as never)

    expect(mocks.removeHandler).toHaveBeenCalledWith('canvas:agent:open-workspace')
    expect(mocks.handle).toHaveBeenCalledOnce()
    expect(mocks.handle).toHaveBeenCalledWith('canvas:agent:open-workspace', expect.any(Function))
  })

  it('keeps preload-only handlers outside the public invoke policy', () => {
    typedIpcHandle('canvas:file:grant-dropped-paths', vi.fn() as never)
    expect(mocks.handle).not.toHaveBeenCalled()

    typedPrivateIpcHandle('canvas:file:grant-dropped-paths', vi.fn() as never)
    expect(mocks.removeHandler).toHaveBeenCalledWith('canvas:file:grant-dropped-paths')
    expect(mocks.handle).toHaveBeenCalledOnce()
    expect(mocks.handle).toHaveBeenCalledWith(
      'canvas:file:grant-dropped-paths',
      expect.any(Function),
    )
  })
})
