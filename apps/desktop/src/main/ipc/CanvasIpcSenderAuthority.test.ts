import { describe, expect, it } from 'vitest'
import {
  isActiveCanvasProjectSender,
  requireActiveCanvasWindowSender,
  requireCanvasProjectManagerSender,
  requireCanvasShellOrActiveWindowSender,
  requireMainCanvasShellSender,
  type CanvasIpcSenderAuthorityDependencies,
} from './CanvasIpcSenderAuthority.js'

const mainSender = { id: 'main' }
const canvasSender = { id: 'canvas' }
const otherSender = { id: 'other' }

function dependencies(
  activeProjectId: string | null = 'project-1',
): CanvasIpcSenderAuthorityDependencies {
  return {
    getMainSender: () => mainSender,
    getCanvasSender: () => canvasSender,
    getActiveProjectId: () => activeProjectId,
  }
}

describe('CanvasIpcSenderAuthority', () => {
  it('only recognizes the Canvas sender for its active project', () => {
    const deps = dependencies()

    expect(isActiveCanvasProjectSender(canvasSender, 'project-1', deps)).toBe(true)
    expect(isActiveCanvasProjectSender(canvasSender, 'project-2', deps)).toBe(false)
    expect(isActiveCanvasProjectSender(mainSender, 'project-1', deps)).toBe(false)
  })

  it('keeps project-list commands on the main Canvas shell', () => {
    const deps = dependencies()

    expect(() => requireMainCanvasShellSender(mainSender, deps)).not.toThrow()
    expect(() => requireMainCanvasShellSender(canvasSender, deps)).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
  })

  it('keeps close confirmation on the Canvas window', () => {
    const deps = dependencies()

    expect(() => requireActiveCanvasWindowSender(canvasSender, deps)).not.toThrow()
    expect(() => requireActiveCanvasWindowSender(otherSender, deps)).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
  })

  it('allows project reads only from the main shell or an active Canvas window', () => {
    expect(() =>
      requireCanvasShellOrActiveWindowSender(mainSender, dependencies()),
    ).not.toThrow()
    expect(() =>
      requireCanvasShellOrActiveWindowSender(canvasSender, dependencies()),
    ).not.toThrow()
    expect(() =>
      requireCanvasShellOrActiveWindowSender(canvasSender, dependencies(null)),
    ).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
    expect(() =>
      requireCanvasShellOrActiveWindowSender(otherSender, dependencies()),
    ).toThrowError(expect.objectContaining({ code: 'PERMISSION_DENIED' }))
  })

  it('allows the main shell or matching active Canvas window to manage a project', () => {
    const deps = dependencies()

    expect(() => requireCanvasProjectManagerSender(mainSender, 'project-2', deps)).not.toThrow()
    expect(() => requireCanvasProjectManagerSender(canvasSender, 'project-1', deps)).not.toThrow()
    expect(() => requireCanvasProjectManagerSender(canvasSender, 'project-2', deps)).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
    expect(() => requireCanvasProjectManagerSender(otherSender, 'project-1', deps)).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
  })
})
