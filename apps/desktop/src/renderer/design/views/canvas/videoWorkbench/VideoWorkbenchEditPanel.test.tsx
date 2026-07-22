// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('antd', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  InputNumber: () => null,
  Select: () => null,
  Slider: () => null,
  message: {
    destroy: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../../Icons', () => ({
  Icons: new Proxy({}, { get: () => () => <span /> }),
}))

import { VideoWorkbenchEditPanel } from './VideoWorkbenchEditPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function click(element: Element | null): void {
  if (element == null) throw new Error('Expected element to exist')
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('VideoWorkbenchEditPanel', () => {
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

  it('records every fixed-duration segment in one output batch', async () => {
    const onProcess = vi.fn().mockResolvedValue({
      success: true,
      result: {
        paths: ['/artifacts/seg_000.mp4', '/artifacts/seg_001.mp4', '/artifacts/seg_002.mp4'],
      },
    })
    const onOutputs = vi.fn()

    await act(async () => {
      root = createRoot(container)
      root.render(
        <VideoWorkbenchEditPanel
          probe={{
            durationSec: 25,
            width: 1280,
            height: 720,
            fps: 24,
            videoCodec: 'h264',
            audioCodec: 'aac',
            hasAudio: true,
            bitrate: 1_000_000,
            fileSize: 1_000_000,
          }}
          busy={false}
          progress={null}
          ffmpegReady
          probeFailed={false}
          fallbackDuration={0}
          onProcess={onProcess}
          onOutputs={onOutputs}
        />,
      )
    })

    const segmentButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '分割视频',
    )
    await act(async () => click(segmentButton ?? null))

    expect(onProcess).toHaveBeenCalledWith('segment', { segmentSec: 10 })
    expect(onOutputs).toHaveBeenCalledOnce()
    expect(onOutputs).toHaveBeenCalledWith([
      {
        summary: '分割 1/3 · 10s',
        outputPath: '/artifacts/seg_000.mp4',
        type: 'segment',
      },
      {
        summary: '分割 2/3 · 10s',
        outputPath: '/artifacts/seg_001.mp4',
        type: 'segment',
      },
      {
        summary: '分割 3/3 · 10s',
        outputPath: '/artifacts/seg_002.mp4',
        type: 'segment',
      },
    ])
  })
})
