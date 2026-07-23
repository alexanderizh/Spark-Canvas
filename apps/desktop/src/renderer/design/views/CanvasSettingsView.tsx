import { useEffect, useState } from 'react'
import { Button } from '@lobehub/ui'
import { useApp } from '../AppContext'
import { Icons } from '../Icons'
import { useToast } from '../components/Toast'
import { FfmpegStatusCard } from './FfmpegStatusCard'
import { CanvasUpdatesSection } from './CanvasUpdatesSection'
import './CanvasSettingsView.less'

export function CanvasSettingsView() {
  const { t, setTweak } = useApp()
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
        <section className="canvas-settings-section canvas-settings-appearance">
          <div>
            <h2>外观</h2>
            <p>选择 Spark Canvas 的界面主题，设置会自动保存。</p>
          </div>
          <div className="canvas-theme-options" role="group" aria-label="界面主题">
            {([
              { value: 'light', label: '浅色', icon: Icons.Sun },
              { value: 'dark', label: '深色', icon: Icons.Moon },
              { value: 'system', label: '跟随系统', icon: Icons.Monitor },
            ] as const).map((option) => {
              const Icon = option.icon
              const active = t.theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  className={active ? 'active' : undefined}
                  aria-pressed={active}
                  onClick={() => setTweak('theme', option.value)}
                >
                  <Icon size={15} />
                  <span>{option.label}</span>
                  {active ? <Icons.Check size={13} /> : null}
                </button>
              )
            })}
          </div>
        </section>
        <section className="canvas-settings-section canvas-settings-environment">
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
