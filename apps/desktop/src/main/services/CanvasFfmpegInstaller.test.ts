import { describe, expect, it, vi } from 'vitest'
import { getCanvasFfmpegInstallAvailability, installCanvasFfmpeg } from './CanvasFfmpegInstaller.js'

describe('CanvasFfmpegInstaller release gate', () => {
  it('fails closed while no approved Spark Canvas descriptor is bundled', async () => {
    const onProgress = vi.fn()

    expect(getCanvasFfmpegInstallAvailability()).toEqual({
      available: false,
      message: expect.stringContaining('受控版本'),
    })
    await expect(installCanvasFfmpeg(onProgress)).resolves.toEqual({
      success: false,
      message: expect.stringContaining('受控版本'),
    })
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'error', percent: null }),
    )
  })
})
