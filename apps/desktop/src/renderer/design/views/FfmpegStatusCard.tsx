/**
 * FfmpegStatusCard — Spark Canvas 视频处理环境状态。
 *
 * 展示：
 *   - ffmpeg/ffprobe 安装状态（版本、来源：managed/system）
 *   - 已批准托管版本的按需下载入口
 *   - 下载进度条（订阅 stream:ffmpeg:install-progress）
 *   - 最近错误信息
 *
 * 风格参考 PlaywrightStatusCard.tsx（同样的 badge / row / progress 结构）。
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { FfmpegInstallProgress, FfmpegStatusResponse } from '@spark/protocol'
import { Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import { useToast } from '../components/Toast'

type Status = FfmpegStatusResponse
type InstallProgress = FfmpegInstallProgress

export function FfmpegStatusCard(): ReactElement {
  const { toast } = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<InstallProgress | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      const result = await window.spark.invoke('ffmpeg:status', {})
      setStatus(result)
    } catch (err) {
      console.warn('[ffmpeg] failed to load status:', err)
    }
  }

  useEffect(() => {
    void window.spark
      .invoke('ffmpeg:status', {})
      .then(setStatus)
      .catch((err: unknown) => {
        console.warn('[ffmpeg] failed to load status:', err)
      })
    const unsubStatus = window.spark?.on('stream:ffmpeg:status', (payload: Status) => {
      setStatus(payload)
    })
    const unsubProgress = window.spark?.on(
      'stream:ffmpeg:install-progress',
      (payload: InstallProgress) => {
        setProgress(payload)
        setInstalling(payload.state !== 'done' && payload.state !== 'error')
      },
    )
    return () => {
      unsubStatus?.()
      unsubProgress?.()
    }
  }, [])

  const handleInstall = async (): Promise<void> => {
    setInstalling(true)
    setProgress(null)
    try {
      const result = await window.spark.invoke('ffmpeg:install', {})
      if (result.success) {
        toast.success(result.message ?? 'FFmpeg 安装成功')
      } else {
        toast.error(result.message ?? 'FFmpeg 安装失败')
      }
      await refresh()
    } catch (err) {
      toast.error(`安装失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstalling(false)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    await refresh()
    toast.success('FFmpeg 状态已刷新')
  }

  if (status == null) {
    return (
      <div className="settings-section">
        <h2>视频处理 (FFmpeg)</h2>
        <div className="lede">画布视频工作台依赖 FFmpeg 进行本地关键帧提取、剪辑与转码。</div>
        <div className="integrity-status-badge unknown">
          <Icons.Refresh size={14} />
          <span>加载中…</span>
        </div>
      </div>
    )
  }

  const ffmpegBadge = status.ffmpegReady ? (
    <span className="badge success dot">
      {status.ffmpegSource === 'managed' ? '已安装' : '系统'} {status.ffmpegVersion ?? ''}
    </span>
  ) : (
    <span className="badge error dot">未安装</span>
  )

  const ffprobeBadge = status.ffprobeReady ? (
    <span className="badge success dot">就绪</span>
  ) : (
    <span className="badge warning dot">缺失</span>
  )

  const progressPercent =
    progress?.percent != null ? Math.max(0, Math.min(100, progress.percent)) : null
  const progressLabel = progressPercent != null ? `${Math.round(progressPercent)}%` : '准备中'
  const isInstallActive =
    progress != null && progress.state !== 'done' && progress.state !== 'error'
  const canInstallManaged = status.managedInstallAvailable

  return (
    <div className="settings-section ffmpeg-settings">
      <div className="ffmpeg-header">
        <div>
          <h2>视频处理 (FFmpeg)</h2>
          <div className="lede">
            画布视频工作台使用 FFmpeg 完成本地关键帧提取、剪辑与转码。兼容的系统版本可直接使用，
            托管版本通过发布校验后可在这里按需下载。
          </div>
        </div>
        <div className="ffmpeg-header-actions">
          <Button
            size="middle"
            type="text"
            onClick={handleRefresh}
            icon={<Icons.Refresh size={14} />}
          >
            重新检查
          </Button>
        </div>
      </div>

      <div className="ffmpeg-summary">
        <div className={`ffmpeg-summary-item ${status.ffmpegSource}`}>
          <Icons.Film size={16} />
          <span>
            {status.ffmpegSource === 'managed'
              ? '使用内置下载的 FFmpeg'
              : status.ffmpegSource === 'system'
                ? '使用系统 FFmpeg'
                : 'FFmpeg 未就绪'}
          </span>
        </div>
        <div className={`ffmpeg-summary-item ${status.ffprobeReady ? 'managed' : 'none'}`}>
          <Icons.Image size={16} />
          <span>ffprobe {status.ffprobeReady ? '可用' : '不可用'}</span>
        </div>
      </div>

      <div className="ffmpeg-card">
        <div className="ffmpeg-row">
          <div className="ffmpeg-row-main">
            <div className="ffmpeg-row-icon">
              <Icons.Film size={18} />
            </div>
            <div>
              <div className="settings-card-title">FFmpeg 二进制</div>
              <div className="settings-card-desc">
                {status.ffmpegReady
                  ? status.ffmpegSource === 'managed'
                    ? `内置版本 ${status.ffmpegVersion ?? ''}，已下载到本地应用目录`
                    : `检测到系统 PATH 中的 FFmpeg ${status.ffmpegVersion ?? ''}，视频处理已就绪`
                  : (status.managedInstallMessage ?? 'FFmpeg 尚未就绪。')}
              </div>
            </div>
          </div>
          <div className="ffmpeg-row-actions">
            {ffmpegBadge}
            <Button
              size="middle"
              type={status.ffmpegReady ? 'default' : 'primary'}
              onClick={handleInstall}
              disabled={installing || !canInstallManaged}
              loading={installing}
              icon={<Icons.Download size={14} />}
            >
              {installing
                ? progressLabel
                : !canInstallManaged
                  ? '托管版待发布'
                  : status.ffmpegSource === 'managed'
                    ? '重新下载'
                    : status.ffmpegSource === 'system'
                      ? '下载内置版本'
                      : '下载 FFmpeg'}
            </Button>
          </div>
          {(progress != null || installing) && (
            <div className="ffmpeg-progress">
              <div className="ffmpeg-progress-head">
                <span>{progress?.message ?? '正在准备下载'}</span>
                <strong>{progressLabel}</strong>
              </div>
              <div
                className={`ffmpeg-progress-track${
                  progressPercent == null && isInstallActive ? ' indeterminate' : ''
                }`}
              >
                <div
                  className="ffmpeg-progress-fill"
                  style={{ width: `${progressPercent ?? 36}%` }}
                />
              </div>
              {progress?.logLine != null && (
                <div className="ffmpeg-progress-log" title={progress.logLine}>
                  {progress.logLine}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ffmpeg-row">
          <div className="ffmpeg-row-main">
            <div className="ffmpeg-row-icon">
              <Icons.Image size={18} />
            </div>
            <div>
              <div className="settings-card-title">FFprobe（元数据探测）</div>
              <div className="settings-card-desc">
                用于探测视频时长、分辨率、编码等元数据，以及解析关键帧时间戳。随 FFmpeg 一起下载。
              </div>
            </div>
          </div>
          <div className="ffmpeg-row-actions">{ffprobeBadge}</div>
        </div>

        {status.lastError != null && (
          <div className="ffmpeg-row error">
            <div>
              <div className="settings-card-title">最近错误</div>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{status.lastError}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
