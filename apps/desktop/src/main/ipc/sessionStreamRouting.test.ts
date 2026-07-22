import { describe, expect, it, vi } from 'vitest'

import { routeSessionStreamEvent } from './sessionStreamRouting.js'

const channel = 'stream:session:agent-event'
const payload = { sessionId: 'session-1', type: 'agent_status' }

function makeDependencies(surface: 'canvas' | null | undefined, delivered = true) {
  return {
    getSessionSurface: vi.fn().mockReturnValue(surface),
    sendToCanvasSession: vi.fn().mockReturnValue(delivered),
    broadcast: vi.fn(),
  }
}

describe('routeSessionStreamEvent', () => {
  it('sends Canvas session events only to the attached Canvas owner', () => {
    const dependencies = makeDependencies('canvas')

    const result = routeSessionStreamEvent(
      dependencies,
      channel,
      payload.sessionId,
      payload,
    )

    expect(result).toBe('canvas-delivered')
    expect(dependencies.sendToCanvasSession).toHaveBeenCalledWith(
      payload.sessionId,
      channel,
      payload,
    )
    expect(dependencies.broadcast).not.toHaveBeenCalled()
  })

  it('does not broadcast a Canvas session event when its owner is detached', () => {
    const dependencies = makeDependencies('canvas', false)

    const result = routeSessionStreamEvent(
      dependencies,
      channel,
      payload.sessionId,
      payload,
    )

    expect(result).toBe('canvas-detached')
    expect(dependencies.broadcast).not.toHaveBeenCalled()
  })

  it('preserves broadcast delivery for non-Canvas sessions', () => {
    const dependencies = makeDependencies(null)

    const result = routeSessionStreamEvent(
      dependencies,
      channel,
      payload.sessionId,
      payload,
    )

    expect(result).toBe('broadcast')
    expect(dependencies.sendToCanvasSession).not.toHaveBeenCalled()
    expect(dependencies.broadcast).toHaveBeenCalledWith(channel, payload)
  })

  it('fails closed when the session record no longer exists', () => {
    const dependencies = makeDependencies(undefined)

    const result = routeSessionStreamEvent(
      dependencies,
      channel,
      payload.sessionId,
      payload,
    )

    expect(result).toBe('session-missing')
    expect(dependencies.sendToCanvasSession).not.toHaveBeenCalled()
    expect(dependencies.broadcast).not.toHaveBeenCalled()
  })
})
