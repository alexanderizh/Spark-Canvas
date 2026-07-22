import { useEffect } from 'react'
import { AppDialogHost, AppProvider, useApp, type ViewId } from './design/AppContext'
import { AuthProvider } from './design/auth/AuthContext'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { ToastContainer, ToastProvider } from './design/components/Toast'
import { Icons } from './design/Icons'
import { LobeThemeProvider } from './design/theme/LobeThemeProvider'
import { useResolvedTheme } from './design/hooks/useResolvedTheme'
import { AccountCenterView } from './design/views/AccountCenterView'
import { CanvasSettingsView } from './design/views/CanvasSettingsView'
import ProvidersView from './design/views/ProvidersView'
import { CanvasProjectsView } from './design/views/canvas/CanvasProjectsView'
import { WindowControls } from './design/components/WindowControls'
import { getCanvasWindowPlatformClass } from './canvasWindowParams'
import './SparkCanvasApp.less'

type CanvasHomeView = 'canvas' | 'providers' | 'account-center' | 'settings'

const CANVAS_HOME_VIEWS = new Set<ViewId>(['canvas', 'providers', 'account-center', 'settings'])

const NAV_ITEMS: Array<{
  id: CanvasHomeView
  label: string
  icon: React.FC<{ size?: number }>
}> = [
  { id: 'canvas', label: '项目', icon: Icons.Canvas },
  { id: 'providers', label: '模型服务', icon: Icons.Server },
  { id: 'account-center', label: '账户', icon: Icons.User },
  { id: 'settings', label: '设置', icon: Icons.Settings },
]

function CanvasThemeBridge({ children }: { children: React.ReactNode }) {
  const { t } = useApp()
  const resolvedTheme = useResolvedTheme()
  return (
    <LobeThemeProvider themeMode={t.theme} resolvedTheme={resolvedTheme} primary={t.primary}>
      {children}
    </LobeThemeProvider>
  )
}

function resolveCanvasHomeView(view: ViewId): CanvasHomeView {
  return CANVAS_HOME_VIEWS.has(view) ? (view as CanvasHomeView) : 'canvas'
}

export function SparkCanvasShell() {
  const { t, setTweak } = useApp()
  const activeView = resolveCanvasHomeView(t.view)

  useEffect(() => {
    if (activeView !== t.view) setTweak('view', activeView)
  }, [activeView, setTweak, t.view])

  const content =
    activeView === 'providers' ? (
      <ProvidersView />
    ) : activeView === 'account-center' ? (
      <AccountCenterView />
    ) : activeView === 'settings' ? (
      <CanvasSettingsView />
    ) : (
      <CanvasProjectsView />
    )

  return (
    <ErrorBoundary level="global" name="SparkCanvas">
      <div
        className={`app window spark-canvas-app theme-${t.theme} density-${t.density} ${getCanvasWindowPlatformClass()}`}
      >
        <aside className="spark-canvas-sidebar">
          <div className="spark-canvas-drag-region" />
          <div className="spark-canvas-brand" aria-label="Spark Canvas">
            <span className="spark-canvas-brand-mark">
              <Icons.Canvas size={22} />
            </span>
            <span>
              <strong>Spark Canvas</strong>
              <small>视频工作台</small>
            </span>
          </div>
          <nav className="spark-canvas-navigation" aria-label="Spark Canvas 导航">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeView === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  data-view={item.id === 'account-center' ? 'account' : item.id}
                  className={isActive ? 'active' : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.label}
                  onClick={() => setTweak('view', item.id)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="spark-canvas-sidebar-status">
            <span className="spark-canvas-status-dot" />
            本地项目
          </div>
        </aside>
        <section className="spark-canvas-main">
          <div className="spark-canvas-window-bar">
            <span>{NAV_ITEMS.find((item) => item.id === activeView)?.label}</span>
            <div className="spark-canvas-window-controls">
              <WindowControls />
            </div>
          </div>
          <div className="spark-canvas-content">
            <div className="spark-canvas-view">{content}</div>
          </div>
        </section>
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}

export function SparkCanvasApp() {
  return (
    <AppProvider>
      <CanvasThemeBridge>
        <AuthProvider>
          <ToastProvider>
            <SparkCanvasShell />
            <AppDialogHost />
          </ToastProvider>
        </AuthProvider>
      </CanvasThemeBridge>
    </AppProvider>
  )
}
