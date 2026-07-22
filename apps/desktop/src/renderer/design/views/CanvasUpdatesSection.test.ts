import { describe, expect, it } from 'vitest'
import { getCanvasUpdatePresentation } from './canvasUpdatePresentation'

describe('getCanvasUpdatePresentation', () => {
  it('offers download and install actions for the corresponding update states', () => {
    expect(
      getCanvasUpdatePresentation({
        state: 'available',
        currentVersion: '0.5.1',
        updateInfo: { version: '0.5.2' } as never,
        progress: null,
        error: null,
      }),
    ).toMatchObject({ label: '发现新版本 v0.5.2', action: 'download' })

    expect(
      getCanvasUpdatePresentation({
        state: 'downloaded',
        currentVersion: '0.5.1',
        updateInfo: { version: '0.5.2' } as never,
        progress: null,
        error: null,
      }),
    ).toMatchObject({ label: '安装包已就绪 v0.5.2', action: 'install' })
  })

  it('keeps checking, downloading and errors visible', () => {
    expect(
      getCanvasUpdatePresentation({
        state: 'checking',
        currentVersion: '0.5.1',
        updateInfo: null,
        progress: null,
        error: null,
      }),
    ).toMatchObject({ label: '正在检查更新', action: null })

    expect(
      getCanvasUpdatePresentation({
        state: 'error',
        currentVersion: '0.5.1',
        updateInfo: null,
        progress: null,
        error: 'network unavailable',
      }),
    ).toMatchObject({ label: '检查失败：network unavailable', action: 'check' })
  })
})
