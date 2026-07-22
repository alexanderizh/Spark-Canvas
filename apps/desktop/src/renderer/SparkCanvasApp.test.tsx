// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./design/views/canvas/CanvasProjectsView', () => ({
  CanvasProjectsView: () => <div data-testid="projects-view">Canvas projects</div>,
}))

vi.mock('./design/views/ProvidersView', () => ({
  default: () => <div data-testid="providers-view">Providers</div>,
}))

vi.mock('./design/views/CanvasSettingsView', () => ({
  CanvasSettingsView: () => <div data-testid="settings-view">Settings</div>,
}))

vi.mock('./design/views/AccountCenterView', () => ({
  AccountCenterView: () => <div data-testid="account-view">Account</div>,
}))

vi.mock('./design/auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./design/theme/LobeThemeProvider', () => ({
  LobeThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./design/hooks/useResolvedTheme', () => ({
  useResolvedTheme: () => 'dark',
}))

vi.mock('./design/components/Toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  ToastContainer: () => null,
}))

vi.mock('./design/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('./design/components/WindowControls', () => ({
  WindowControls: () => <div data-testid="window-controls">Window controls</div>,
}))

vi.mock('./design/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}))

vi.mock('./design/components/PromptDialog', () => ({
  PromptDialog: () => null,
}))

vi.mock('./design/hooks/useAppDialogKeyboard', () => ({
  useGlobalDialogEnterConfirm: () => {},
}))

import { AppProvider } from './design/AppContext'
import { SparkCanvasShell } from './SparkCanvasApp'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function click(element: Element | null): void {
  if (element == null) throw new Error('Expected element to exist')
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('SparkCanvasShell', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('opens on the Canvas project list without old platform navigation', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <AppProvider>
          <SparkCanvasShell />
        </AppProvider>,
      )
    })

    expect(container.querySelector('[data-testid="projects-view"]')).not.toBeNull()
    expect(
      container.querySelector('.spark-canvas-view > [data-testid="projects-view"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('.spark-canvas-window-controls > [data-testid="window-controls"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain('Spark Canvas')
    expect(container.textContent).toContain('项目')
    expect(container.textContent).toContain('模型服务')
    expect(container.textContent).toContain('账户')
    expect(container.textContent).toContain('设置')
    expect(container.textContent).not.toContain('工作流')
    expect(container.textContent).not.toContain('团队')
    expect(container.textContent).not.toContain('代码工作台')
  })

  it('navigates only among approved Canvas support views', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <AppProvider>
          <SparkCanvasShell />
        </AppProvider>,
      )
    })

    await act(async () => click(container.querySelector('[data-view="providers"]')))
    expect(container.querySelector('[data-testid="providers-view"]')).not.toBeNull()

    await act(async () => click(container.querySelector('[data-view="account"]')))
    expect(container.querySelector('[data-testid="account-view"]')).not.toBeNull()

    await act(async () => click(container.querySelector('[data-view="settings"]')))
    expect(container.querySelector('[data-testid="settings-view"]')).not.toBeNull()
  })
})
