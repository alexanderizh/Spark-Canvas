import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@spark/agent-runtime', () => ({
  canvasAllowedToolNames: vi.fn(() => []),
  createCanvasMcpServer: vi.fn(),
}))

vi.mock('@spark/shared', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
  })),
}))

import { CanvasHostBridge } from './canvas-host-bridge.js'

interface FakeWebContents {
  value: WebContents
  send: ReturnType<typeof vi.fn>
  markDestroyed: () => void
  destroy: () => void
}

interface PromiseState {
  status: 'pending' | 'resolved' | 'rejected'
  value?: unknown
}

function createFakeWebContents(): FakeWebContents {
  const destroyedListeners: Array<() => void> = []
  let destroyed = false
  const send = vi.fn()
  const value = {
    send,
    isDestroyed: vi.fn(() => destroyed),
    once: vi.fn((eventName: string, listener: () => void) => {
      if (eventName === 'destroyed') destroyedListeners.push(listener)
    }),
  } as unknown as WebContents

  return {
    value,
    send,
    markDestroyed: () => {
      destroyed = true
    },
    destroy: () => {
      destroyed = true
      for (const listener of destroyedListeners.splice(0)) listener()
    },
  }
}

function dispatchedRequestId(webContents: FakeWebContents, callIndex = 0): string {
  const payload = webContents.send.mock.calls[callIndex]?.[1] as
    | { requestId?: unknown }
    | undefined
  if (typeof payload?.requestId !== 'string') throw new Error('Missing dispatched request id')
  return payload.requestId
}

function observePromise(promise: Promise<unknown>): () => PromiseState {
  const state: PromiseState = { status: 'pending' }
  void promise.then(
    (value) => Object.assign(state, { status: 'resolved', value }),
    (error) => Object.assign(state, { status: 'rejected', value: error }),
  )
  return () => state
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('CanvasHostBridge sender ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('only lets the current attachment owner detach a session', () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    const other = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')

    bridge.detach('session-1', other.value)
    expect(bridge.isAttached('session-1')).toBe(true)

    bridge.detach('session-1', owner.value)
    expect(bridge.isAttached('session-1')).toBe(false)
  })

  it('rejects only pending calls belonging to the detached session', async () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')
    bridge.attach('session-2', owner.value, 'project-2')
    const first = bridge.callTool('session-1', 'first_tool', {})
    const second = bridge.callTool('session-2', 'second_tool', {})
    const firstState = observePromise(first)
    const secondState = observePromise(second)

    bridge.detach('session-1', owner.value)
    await flushPromises()

    expect(firstState().status).toBe('rejected')
    expect(secondState().status).toBe('pending')
    bridge.handleToolResult(
      { requestId: dispatchedRequestId(owner, 1), ok: true, result: 'second' },
      owner.value,
    )
    await expect(second).resolves.toBe('second')
  })

  it('rejects old pending calls when an attachment is replaced', async () => {
    const bridge = new CanvasHostBridge()
    const oldOwner = createFakeWebContents()
    const newOwner = createFakeWebContents()
    bridge.attach('session-1', oldOwner.value, 'project-1')
    const oldCall = bridge.callTool('session-1', 'old_tool', {})
    const oldCallState = observePromise(oldCall)

    bridge.attach('session-1', newOwner.value, 'project-2')
    await flushPromises()

    expect(oldCallState().status).toBe('rejected')
    oldOwner.destroy()
    expect(bridge.isAttached('session-1')).toBe(true)

    const newCall = bridge.callTool('session-1', 'new_tool', {})
    bridge.handleToolResult(
      { requestId: dispatchedRequestId(newOwner), ok: true, result: 'new' },
      newOwner.value,
    )
    await expect(newCall).resolves.toBe('new')
  })

  it('rejects pending calls when the current attachment window is destroyed', async () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')
    const pending = bridge.callTool('session-1', 'test_tool', {})
    const state = observePromise(pending)

    owner.destroy()
    await flushPromises()

    expect(bridge.isAttached('session-1')).toBe(false)
    expect(state().status).toBe('rejected')
  })

  it('sends a session event only to its current attachment owner', () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    const payload = { status: 'changed' }
    bridge.attach('session-1', owner.value, 'project-1')

    expect(bridge.sendToAttachedSession('session-1', 'stream:canvas:test', payload)).toBe(true)
    expect(owner.send).toHaveBeenLastCalledWith('stream:canvas:test', payload)
  })

  it('does not send a session event when the session is not attached', () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()

    expect(bridge.sendToAttachedSession('session-1', 'stream:canvas:test', {})).toBe(false)
    expect(owner.send).not.toHaveBeenCalled()
  })

  it('cleans the attachment and pending calls instead of sending to a destroyed owner', async () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')
    const pending = bridge.callTool('session-1', 'test_tool', {})
    const state = observePromise(pending)
    owner.send.mockClear()
    owner.markDestroyed()

    expect(bridge.sendToAttachedSession('session-1', 'stream:canvas:test', {})).toBe(false)
    await flushPromises()

    expect(owner.send).not.toHaveBeenCalled()
    expect(bridge.isAttached('session-1')).toBe(false)
    expect(state().status).toBe('rejected')
  })

  it('ignores unknown and wrong-sender ACKs', async () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    const other = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')
    const pending = bridge.callTool('session-1', 'test_tool', {})
    const state = observePromise(pending)

    bridge.handleToolAck('unknown', owner.value)
    bridge.handleToolAck(dispatchedRequestId(owner), other.value)
    await vi.advanceTimersByTimeAsync(5_001)

    expect(state().status).toBe('rejected')
    expect(state().value).toMatchObject({ message: expect.stringContaining('未确认接收') })
  })

  it('ignores unknown and wrong-sender results without consuming a pending call', async () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    const other = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')
    const pending = bridge.callTool('session-1', 'test_tool', {})
    const state = observePromise(pending)
    const requestId = dispatchedRequestId(owner)

    bridge.handleToolResult({ requestId: 'unknown', ok: true, result: 'unknown' }, owner.value)
    bridge.handleToolResult({ requestId, ok: true, result: 'hijacked' }, other.value)
    await flushPromises()
    expect(state().status).toBe('pending')

    bridge.handleToolResult({ requestId, ok: true, result: 'owner' }, owner.value)
    await expect(pending).resolves.toBe('owner')
  })

  it('does not extend the execution timeout for duplicate ACKs', async () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')
    const pending = bridge.callTool('session-1', 'test_tool', {})
    const state = observePromise(pending)
    const requestId = dispatchedRequestId(owner)

    bridge.handleToolAck(requestId, owner.value)
    await vi.advanceTimersByTimeAsync(59_000)
    bridge.handleToolAck(requestId, owner.value)
    await vi.advanceTimersByTimeAsync(1_001)

    expect(state().status).toBe('rejected')
    expect(state().value).toMatchObject({ message: expect.stringContaining('执行超时') })
  })

  it('ignores duplicate results without affecting another pending call', async () => {
    const bridge = new CanvasHostBridge()
    const owner = createFakeWebContents()
    bridge.attach('session-1', owner.value, 'project-1')
    const first = bridge.callTool('session-1', 'first_tool', {})
    const second = bridge.callTool('session-1', 'second_tool', {})
    const firstRequestId = dispatchedRequestId(owner, 0)
    const secondRequestId = dispatchedRequestId(owner, 1)

    bridge.handleToolResult({ requestId: firstRequestId, ok: true, result: 'first' }, owner.value)
    await expect(first).resolves.toBe('first')
    bridge.handleToolResult(
      { requestId: firstRequestId, ok: false, error: 'duplicate' },
      owner.value,
    )
    bridge.handleToolResult(
      { requestId: secondRequestId, ok: true, result: 'second' },
      owner.value,
    )

    await expect(second).resolves.toBe('second')
  })
})
