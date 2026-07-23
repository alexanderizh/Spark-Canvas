// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setTweak: vi.fn(),
  theme: 'dark' as 'light' | 'dark' | 'system',
}))

vi.mock('../AppContext', () => ({
  useApp: () => ({ t: { theme: mocks.theme }, setTweak: mocks.setTweak }),
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: { error: vi.fn() } }),
}))

vi.mock('./FfmpegStatusCard', () => ({ FfmpegStatusCard: () => null }))
vi.mock('./CanvasUpdatesSection', () => ({ CanvasUpdatesSection: () => null }))

import { CanvasSettingsView } from './CanvasSettingsView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('CanvasSettingsView', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    mocks.setTweak.mockReset()
    mocks.theme = 'dark'
    container = document.createElement('div')
    document.body.appendChild(container)
    window.spark = {
      invoke: vi.fn().mockResolvedValue({ appVersion: '0.5.1' }),
    } as unknown as typeof window.spark
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('shows all theme choices and switches the application theme', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<CanvasSettingsView />)
    })

    const dark = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('深色'),
    )
    const system = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('跟随系统'),
    )

    expect(container.textContent).toContain('浅色')
    expect(dark?.getAttribute('aria-pressed')).toBe('true')
    expect(system).toBeDefined()

    await act(async () => system?.click())
    expect(mocks.setTweak).toHaveBeenCalledWith('theme', 'system')
  })
})
