/**
 * 开发环境「随父进程退出」。
 *
 * `pnpm dev` 通过 electron-vite 以子进程方式拉起 Electron 主进程。当开发者停止
 * dev 任务（Ctrl+C / 关闭终端 / IDE 里点停止）时，需要让 Electron 主进程一并退出，
 * 否则会残留后台常驻实例（本项目关窗默认隐藏到托盘，dev 又无单实例锁）。
 *
 * 覆盖两种停止方式：
 *   1. 信号直接送达本进程：Ctrl+C(SIGINT)、终端关闭(SIGHUP)、IDE 停止(SIGTERM)。
 *   2. 父进程被杀但信号未送达本进程（如 IDE 只杀直接子进程 electron-vite）：
 *      轮询 ppid，一旦父进程退出（子进程被 init(1)/launchd 收养，ppid 改变）即退出。
 *
 * 仅用于开发环境，生产环境不调用。
 */

type DevAutoQuitApp = {
  quit: () => void
}

type DevAutoQuitProcess = Pick<NodeJS.Process, 'ppid' | 'on' | 'off'>

export type InstallDevAutoQuitOptions = {
  app: DevAutoQuitApp
  /** 注入点，便于测试；默认使用当前进程。 */
  proc?: DevAutoQuitProcess
  /** ppid 轮询间隔，默认 2000ms。 */
  intervalMs?: number
  /** 触发退出前的回调（如置位退出守卫 isQuitting）。 */
  onBeforeQuit?: () => void
}

/**
 * 安装 dev 随父退出机制，返回清理函数（移除监听与定时器）。
 */
export function installDevAutoQuit(options: InstallDevAutoQuitOptions): () => void {
  const proc = options.proc ?? process
  const intervalMs = options.intervalMs ?? 2000
  let stopped = false

  const quit = (): void => {
    if (stopped) return
    stopped = true
    options.onBeforeQuit?.()
    options.app.quit()
  }

  const onSignal = (): void => quit()
  proc.on('SIGINT', onSignal)
  proc.on('SIGTERM', onSignal)
  proc.on('SIGHUP', onSignal)

  const initialPpid = proc.ppid
  const timer = setInterval(() => {
    // 父进程退出后，Unix 会把子进程收养给 init(1)/launchd，ppid 随之改变。
    // 初始 ppid 已是 1 时无法用该启发式，跳过（避免误判）。
    if (initialPpid !== 1 && proc.ppid !== initialPpid) quit()
  }, intervalMs)
  timer.unref?.()

  return (): void => {
    clearInterval(timer)
    proc.off('SIGINT', onSignal)
    proc.off('SIGTERM', onSignal)
    proc.off('SIGHUP', onSignal)
  }
}
