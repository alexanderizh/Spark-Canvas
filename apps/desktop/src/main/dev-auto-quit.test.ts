import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDevAutoQuit } from './dev-auto-quit.js'

class FakeProcess extends EventEmitter {
  constructor(public ppid: number) {
    super()
  }
}

describe('installDevAutoQuit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('quits on SIGINT / SIGTERM / SIGHUP', () => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      const proc = new FakeProcess(100)
      const quit = vi.fn()
      const onBeforeQuit = vi.fn()
      installDevAutoQuit({ app: { quit }, proc, onBeforeQuit })

      proc.emit(signal)

      expect(onBeforeQuit).toHaveBeenCalledTimes(1)
      expect(quit).toHaveBeenCalledTimes(1)
    }
  })

  it('quits only once even if multiple signals fire', () => {
    const proc = new FakeProcess(100)
    const quit = vi.fn()
    installDevAutoQuit({ app: { quit }, proc })

    proc.emit('SIGINT')
    proc.emit('SIGTERM')

    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('quits when the parent process dies (ppid changes)', () => {
    const proc = new FakeProcess(100)
    const quit = vi.fn()
    installDevAutoQuit({ app: { quit }, proc, intervalMs: 1000 })

    vi.advanceTimersByTime(1000)
    expect(quit).not.toHaveBeenCalled()

    proc.ppid = 1 // 父进程退出后被 launchd/init 收养
    vi.advanceTimersByTime(1000)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('does not use the reparent heuristic when initial ppid is already 1', () => {
    const proc = new FakeProcess(1)
    const quit = vi.fn()
    installDevAutoQuit({ app: { quit }, proc, intervalMs: 1000 })

    vi.advanceTimersByTime(5000)
    expect(quit).not.toHaveBeenCalled()
  })

  it('stops watching after dispose', () => {
    const proc = new FakeProcess(100)
    const quit = vi.fn()
    const dispose = installDevAutoQuit({ app: { quit }, proc, intervalMs: 1000 })

    dispose()
    proc.ppid = 1
    vi.advanceTimersByTime(5000)
    proc.emit('SIGINT')

    expect(quit).not.toHaveBeenCalled()
  })
})
