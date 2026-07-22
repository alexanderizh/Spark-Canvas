import { useEffect, useState } from 'react'
import { Button } from '@lobehub/ui'
import type { UpdateStatus } from '@spark/protocol'
import { Icons } from '../Icons'
import { getCanvasUpdatePresentation, type CanvasUpdateAction } from './canvasUpdatePresentation'
import './CanvasUpdatesSection.less'

export function CanvasUpdatesSection(): React.ReactElement {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    void window.spark
      .invoke('update:get-status', {})
      .then((result) => setStatus(result.status))
      .catch(() => undefined)
    return window.spark.on('stream:update:status', setStatus)
  }, [])

  const runAction = async (action: CanvasUpdateAction): Promise<void> => {
    if (action === 'check') {
      const result = await window.spark.invoke('update:check', {})
      setStatus(result.status)
    } else if (action === 'download') {
      await window.spark.invoke('update:download', {})
    } else if (action === 'install') {
      await window.spark.invoke('update:install-restart', {})
    }
  }

  const presentation = status ? getCanvasUpdatePresentation(status) : null
  const Icon =
    presentation?.tone === 'error'
      ? Icons.AlertTriangle
      : presentation?.tone === 'warning'
        ? Icons.Download
        : presentation?.tone === 'active'
          ? Icons.Refresh
          : Icons.CheckCircle
  const actionLabel =
    presentation?.action === 'download'
      ? '下载更新'
      : presentation?.action === 'install'
        ? window.spark.platform === 'darwin'
          ? '打开安装镜像'
          : '安装更新'
        : '检查更新'

  return (
    <div className="canvas-updates-section">
      <div className={`canvas-updates-status ${presentation?.tone ?? 'active'}`}>
        <Icon size={18} />
        <div>
          <h2>应用更新</h2>
          <p>{presentation?.label ?? '正在读取更新状态'}</p>
          {status ? <small>Spark Canvas v{status.currentVersion}</small> : null}
        </div>
      </div>
      <Button
        type={
          presentation?.action === 'download' || presentation?.action === 'install'
            ? 'primary'
            : 'text'
        }
        icon={
          presentation?.action === 'download' ? (
            <Icons.Download size={15} />
          ) : (
            <Icons.Refresh size={15} />
          )
        }
        disabled={presentation?.action == null}
        loading={status?.state === 'checking' || status?.state === 'downloading'}
        onClick={() => void runAction(presentation?.action ?? null)}
      >
        {actionLabel}
      </Button>
    </div>
  )
}
