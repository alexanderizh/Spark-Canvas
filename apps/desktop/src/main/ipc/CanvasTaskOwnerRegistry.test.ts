import { describe, expect, it } from 'vitest'
import { CanvasTaskOwnerRegistry } from './CanvasTaskOwnerRegistry.js'

describe('CanvasTaskOwnerRegistry', () => {
  it('binds cancellation to the creating sender and active project', () => {
    const registry = new CanvasTaskOwnerRegistry()
    const owner = { id: 'canvas-owner' }
    registry.claim('task-1', owner, 'project-1')

    expect(() => registry.requireOwner('task-1', owner, 'project-1')).not.toThrow()
    expect(() => registry.requireOwner('task-1', { id: 'other' }, 'project-1')).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
    expect(() => registry.requireOwner('task-1', owner, 'project-2')).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
  })

  it('releases completed tasks', () => {
    const registry = new CanvasTaskOwnerRegistry()
    const owner = { id: 'canvas-owner' }
    registry.claim('task-1', owner, 'project-1')
    registry.release('task-1')

    expect(() => registry.requireOwner('task-1', owner, 'project-1')).toThrowError(
      expect.objectContaining({ code: 'PERMISSION_DENIED' }),
    )
  })
})
