// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot } from './canvas.types'
import { CanvasAgentModal } from './CanvasAgentModal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Dropdown: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
  }
})

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      icon,
      children,
      onClick,
      disabled,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) =>
      ReactActual.createElement(
        'button',
        { type: 'button', onClick, disabled, ...props },
        icon,
        children,
      ),
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
  }
})

vi.mock('../../Icons', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Icon = () => ReactActual.createElement('span', { 'data-icon': true })
  return {
    Icons: {
      Bot: Icon,
      Check: Icon,
      ChevronDown: Icon,
      Code: Icon,
      Layers: Icon,
      Maximize: Icon,
      MessageSquare: Icon,
      MessageSquarePlus: Icon,
      Minimize: Icon,
      Skills: Icon,
      Sparkles: Icon,
      X: Icon,
    },
  }
})

vi.mock('../../components/ChatPanel', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    ChatPanel: ({ sessionId }: { sessionId?: string | null }) =>
      ReactActual.createElement('div', { 'data-session-id': sessionId ?? 'none' }),
  }
})

vi.mock('../../components/SkillsPickerModal', () => ({ SkillsPickerModal: () => null }))
vi.mock('../../components/AvatarImage', () => ({ AvatarImage: () => null }))
vi.mock('../../components/ProviderLogo', () => ({ ProviderLogo: () => null }))
vi.mock('./canvas-tool-host', () => ({
  useCanvasToolHost: () => ({
    status: 'detached',
    error: null,
    ensureAttached: async () => undefined,
    reconnect: async () => undefined,
  }),
}))

const snapshot = {
  project: { id: 'project-1', title: 'Film', rootPath: '/tmp/film' },
  board: { id: 'board-1', name: 'Board' },
  nodes: [],
  edges: [],
  assets: [],
  tasks: [],
} as unknown as CanvasSnapshot

describe('CanvasAgentModal session surface', () => {
  let root: Root | null = null
  let container: HTMLDivElement
  let invoke: ReturnType<typeof vi.fn>
  let on: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke = vi.fn((channel: string) => {
      if (channel === 'canvas:agent:open-workspace') {
        return Promise.resolve({ workspaceId: 'workspace-1' })
      }
      if (channel === 'canvas:agent:session:list') {
        return Promise.resolve({ sessions: [], total: 0 })
      }
      if (channel === 'canvas:agent:configuration') {
        return Promise.resolve({ agents: [], skills: [] })
      }
      if (channel === 'provider:list') return Promise.resolve({ profiles: [] })
      return Promise.resolve({})
    })
    on = vi.fn(() => vi.fn())
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke, on, platform: 'darwin' },
    })
  })

  afterEach(() => {
    if (root != null) act(() => root?.unmount())
    root = null
    container.remove()
    document.body.innerHTML = ''
  })

  async function renderModal(): Promise<void> {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <CanvasAgentModal
          open
          onClose={vi.fn()}
          snapshot={snapshot}
          selectedNodes={[]}
          workspace={{} as never}
          nodeRefs={[]}
        />,
      )
      await Promise.resolve()
    })
  }

  it('queries only canvas sessions for the project workspace', async () => {
    await renderModal()

    expect(invoke).toHaveBeenCalledWith('canvas:agent:open-workspace', {
      projectId: 'project-1',
    })
    expect(invoke).not.toHaveBeenCalledWith('workspace:open', expect.anything())
    expect(invoke).toHaveBeenCalledWith('canvas:agent:session:list', {
      includeArchived: false,
      limit: 50,
    })
  })

  it('does not subscribe to redundant created events', async () => {
    await renderModal()

    expect(on).toHaveBeenCalledWith('stream:session:renamed', expect.any(Function))
    expect(on).toHaveBeenCalledWith('stream:session:agent-event', expect.any(Function))
    expect(on).not.toHaveBeenCalledWith('stream:session:created', expect.any(Function))
  })
})
