import { useEffect, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../Icons'
import { useToast } from '../components/Toast'
import { FfmpegStatusCard } from './FfmpegStatusCard'
import { CanvasUpdatesSection } from './CanvasUpdatesSection'
import './CanvasSettingsView.less'

export function CanvasSettingsView() {
  const { toast } = useToast()
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    void window.spark
      .invoke('app:get-info', {})
      .then((info) => setVersion(info.appVersion))
      .catch(() => setVersion(null))
  }, [])

  const openDataDirectory = async (): Promise<void> => {
    const result = await window.spark.invoke('app:open-data-dir', {})
    if (!result.opened) toast.error('无法打开 Spark Canvas 数据目录')
  }

  return (
    <div className="canvas-settings-view">
      <header>
        <span>WORKBENCH SETTINGS</span>
        <h1>设置</h1>
        <p>管理视频处理环境和本地 Spark Canvas 数据。</p>
      </header>
      <main>
        <section className="canvas-settings-section">
          <FfmpegStatusCard />
        </section>
        <section className="canvas-settings-section">
          <CanvasUpdatesSection />
        </section>
        <section className="canvas-settings-section">
          <div>
            <h2>本地数据</h2>
            <p>项目、数据库和缓存存放在独立的 Spark Canvas 应用目录。</p>
          </div>
          <Button
            type="text"
            icon={<Icons.FolderOpen size={15} />}
            onClick={() => void openDataDirectory()}
          >
            打开数据目录
          </Button>
        </section>
        <section className="canvas-settings-section canvas-settings-about">
          <div>
            <h2>Spark Canvas</h2>
            <p>AI 影视与短剧生产工作台{version ? ` · v${version}` : ''}</p>
          </div>
        </section>
      </main>
    </div>
  )
}
