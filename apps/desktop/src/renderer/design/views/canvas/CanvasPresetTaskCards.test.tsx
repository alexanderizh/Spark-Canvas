// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasPresetTaskCards } from './CanvasPresetTaskCards'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./CanvasAgentModal', () => ({
  ProviderModelPickerInline: () =>
    React.createElement('div', { className: 'provider-model-picker' }, 'Model picker'),
}))

vi.mock('./CanvasModelPicker', () => ({
  CanvasModelPicker: () =>
    React.createElement('div', { className: 'media-model-picker' }, 'Media model picker'),
}))

describe('CanvasPresetTaskCards', () => {
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

  it('renders four plain-language task defaults with semantic icons', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <CanvasPresetTaskCards
          value={{
            text: { skillIds: [] },
            image_understanding: { skillIds: [] },
            image_generation: { skillIds: [] },
            video_generation: { skillIds: [] },
          }}
          providers={[]}
          imageModels={[]}
          videoModels={[]}
          loading={false}
          onChange={vi.fn()}
        />,
      )
    })

    expect(container.querySelectorAll('.canvas-preset-task-card')).toHaveLength(4)
    expect(container.textContent).toContain('文本处理')
    expect(container.textContent).toContain('图片理解')
    expect(container.textContent).toContain('图片生成')
    expect(container.textContent).toContain('视频生成')
    expect(container.querySelectorAll('.canvas-preset-task-icon')).toHaveLength(4)
  })

  it('shows only the text model picker when legacy Agent defaults exist', () => {
    act(() => {
      root = createRoot(container)
      root.render(
        <CanvasPresetTaskCards
          value={{
            text: {
              agentId: 'agent:writer',
              providerProfileId: 'provider:text',
              modelId: 'gpt-5',
              skillIds: [],
            },
            image_understanding: { skillIds: [] },
            image_generation: { skillIds: [] },
            video_generation: { skillIds: [] },
          }}
          providers={[]}
          imageModels={[]}
          videoModels={[]}
          loading={false}
          onChange={vi.fn()}
        />,
      )
    })

    const textCard = container.querySelector<HTMLElement>('[data-task-kind="text"]')
    expect(textCard?.querySelector('.provider-model-picker')).not.toBeNull()
    expect(textCard?.querySelector('.agent-picker')).toBeNull()
    expect(textCard?.textContent).not.toContain('交给 Agent')
  })

  it('lets users return one task card to the platform recommendation', () => {
    const onChange = vi.fn()
    act(() => {
      root = createRoot(container)
      root.render(
        <CanvasPresetTaskCards
          value={{
            text: {
              providerProfileId: 'provider:text',
              modelId: 'gpt-5',
              skillIds: [],
            },
            image_understanding: { skillIds: [] },
            image_generation: { skillIds: [] },
            video_generation: { skillIds: [] },
          }}
          providers={[]}
          imageModels={[]}
          videoModels={[]}
          loading={false}
          onChange={onChange}
        />,
      )
    })

    const textCard = container.querySelector<HTMLElement>('[data-task-kind="text"]')
    const reset = Array.from(textCard?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent === '恢复推荐',
    )
    act(() => reset?.click())

    expect(onChange).toHaveBeenCalledWith('text', { skillIds: [] })
  })
})
