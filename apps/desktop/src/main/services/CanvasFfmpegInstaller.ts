import type { FfmpegInstallProgress, FfmpegInstallResponse } from '@spark/protocol'

const RELEASE_GATE_MESSAGE =
  'Spark Canvas 托管 FFmpeg 受控版本尚未发布；已禁用旧 Spark 安装源。当前可继续使用兼容的系统 FFmpeg。'

export interface CanvasFfmpegInstallAvailability {
  available: boolean
  message: string
}

export function getCanvasFfmpegInstallAvailability(): CanvasFfmpegInstallAvailability {
  return { available: false, message: RELEASE_GATE_MESSAGE }
}

export function installCanvasFfmpeg(
  onProgress: (progress: FfmpegInstallProgress) => void,
): Promise<FfmpegInstallResponse> {
  const availability = getCanvasFfmpegInstallAvailability()
  onProgress({
    state: 'error',
    percent: null,
    message: availability.message,
    logLine: null,
  })
  return Promise.resolve({ success: false, message: availability.message })
}
