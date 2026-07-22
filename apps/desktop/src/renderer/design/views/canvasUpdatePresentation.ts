import type { UpdateStatus } from '@spark/protocol'

export type CanvasUpdateAction = 'check' | 'download' | 'install' | null

export interface CanvasUpdatePresentation {
  action: CanvasUpdateAction
  label: string
  tone: 'idle' | 'active' | 'success' | 'warning' | 'error'
}

export function getCanvasUpdatePresentation(status: UpdateStatus): CanvasUpdatePresentation {
  const version = status.updateInfo?.version ?? '?'
  switch (status.state) {
    case 'checking':
      return { action: null, label: '正在检查更新', tone: 'active' }
    case 'available':
      return { action: 'download', label: `发现新版本 v${version}`, tone: 'warning' }
    case 'downloading':
      return {
        action: null,
        label: `正在下载${status.progress ? ` ${Math.round(status.progress.percent)}%` : ''}`,
        tone: 'active',
      }
    case 'downloaded':
      return { action: 'install', label: `安装包已就绪 v${version}`, tone: 'success' }
    case 'error':
      return {
        action: 'check',
        label: `检查失败：${status.error ?? '未知错误'}`,
        tone: 'error',
      }
    case 'idle':
    case 'not-available':
      return { action: 'check', label: '当前已是最新版本', tone: 'idle' }
  }
}
