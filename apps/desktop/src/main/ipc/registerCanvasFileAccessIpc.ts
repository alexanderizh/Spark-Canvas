import type { CanvasFileAccessController } from './CanvasFileAccessController.js'
import type { CanvasFileAccessGrantSender } from '../services/CanvasFileAccessGrantService.js'
import { typedIpcHandle, typedPrivateIpcHandle } from './typed-ipc.js'

/**
 * 主入口接线：把 dialog:open-directory / dialog:open-file / file:stat-kind /
 * file:read-text 四个原生文件访问通道统一交给 {@link CanvasFileAccessController}。
 *
 * 关键约束：所有原生选择结果都绑定 `event.sender`，由 Controller 负责 grant 记录与
 * per-sender + 可信 DB project root 的授权判定。index.ts 中不再保留任何裸 handler
 * 直接触碰 dialog/fs —— 避免 renderer 提供的路径绕过授权边界。
 */
export interface RegisterCanvasFileAccessIpcOptions {
  controller: CanvasFileAccessController
}

export function registerCanvasFileAccessIpc({
  controller,
}: RegisterCanvasFileAccessIpcOptions): void {
  typedPrivateIpcHandle('canvas:file:grant-dropped-paths', async (req, event) => ({
    paths: controller.grantDroppedPaths(
      event.sender as CanvasFileAccessGrantSender,
      req.paths,
    ),
  }))

  typedIpcHandle('dialog:open-directory', (req, event) =>
    controller.openDirectory(event.sender as CanvasFileAccessGrantSender, {
      ...(req.title !== undefined ? { title: req.title } : {}),
      ...(req.defaultPath !== undefined ? { defaultPath: req.defaultPath } : {}),
    }),
  )

  typedIpcHandle('dialog:open-file', (req, event) =>
    controller.openFile(event.sender as CanvasFileAccessGrantSender, {
      ...(req.title !== undefined ? { title: req.title } : {}),
      ...(req.defaultPath !== undefined ? { defaultPath: req.defaultPath } : {}),
      ...(req.multiple !== undefined ? { multiple: req.multiple } : {}),
      ...(req.allowDirectories !== undefined ? { allowDirectories: req.allowDirectories } : {}),
      ...(req.filters !== undefined ? { filters: req.filters } : {}),
    }),
  )

  typedIpcHandle('file:stat-kind', async (req, event) => ({
    kind: controller.statKind(event.sender as CanvasFileAccessGrantSender, req.path),
  }))

  typedIpcHandle('file:read-text', async (req, event) =>
    controller.readText(event.sender as CanvasFileAccessGrantSender, req.path),
  )
}
