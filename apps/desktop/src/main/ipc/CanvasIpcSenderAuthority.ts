import { SparkError } from '@spark/shared'

export interface CanvasIpcSenderAuthorityDependencies {
  getMainSender(): unknown | null
  getCanvasSender(): unknown | null
  getActiveProjectId(): string | null
}

export function isActiveCanvasProjectSender(
  sender: unknown,
  projectId: string,
  dependencies: CanvasIpcSenderAuthorityDependencies,
): boolean {
  return (
    dependencies.getCanvasSender() === sender &&
    dependencies.getActiveProjectId() === projectId
  )
}

export function requireMainCanvasShellSender(
  sender: unknown,
  dependencies: CanvasIpcSenderAuthorityDependencies,
): void {
  if (dependencies.getMainSender() !== sender) {
    throw new SparkError('PERMISSION_DENIED', '当前窗口无权管理画布项目。')
  }
}

export function requireActiveCanvasWindowSender(
  sender: unknown,
  dependencies: CanvasIpcSenderAuthorityDependencies,
): void {
  if (dependencies.getCanvasSender() !== sender) {
    throw new SparkError('PERMISSION_DENIED', '当前窗口不是活动画布窗口。')
  }
}

export function requireCanvasShellOrActiveWindowSender(
  sender: unknown,
  dependencies: CanvasIpcSenderAuthorityDependencies,
): void {
  if (dependencies.getMainSender() === sender) return
  if (
    dependencies.getCanvasSender() === sender &&
    dependencies.getActiveProjectId() != null
  ) {
    return
  }
  throw new SparkError('PERMISSION_DENIED', '当前窗口无权访问画布项目。')
}

export function requireCanvasProjectManagerSender(
  sender: unknown,
  projectId: string,
  dependencies: CanvasIpcSenderAuthorityDependencies,
): void {
  if (
    dependencies.getMainSender() !== sender &&
    !isActiveCanvasProjectSender(sender, projectId, dependencies)
  ) {
    throw new SparkError('PERMISSION_DENIED', '当前窗口无权管理该画布项目。', {
      projectId,
    })
  }
}
