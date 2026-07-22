import { realpathSync, statSync } from 'node:fs'

/**
 * Canvas 项目包导入/导出的授权与路径解析层。
 *
 * 只做「谁被允许把哪个 canonical 路径当作源/目标」这一件事，不复制打包实现：
 *   - 源目录一律取自 DB 的 root_path（权威），忽略 renderer 传入的任何源路径
 *   - 导出目标 / 导入源目录必须来自同一 sender 通过原生 dialog 获得的 grant
 *   - 导入目标只能是可信默认 projects root 或同一 sender 的目录 grant
 *   - symlink 逃逸、prefix 兄弟目录、跨窗口、已删除项目全部 fail closed
 *
 * 依赖以接口注入，不直接耦合 Electron —— 便于单测用真实 {@link CanvasFileAccessGrantService}
 * 与临时目录覆盖 symlink / canonical 行为。实际打包/校验仍由
 * CanvasPortableProjectPackage / CanvasProjectPackageFiles 负责。
 */

export interface CanvasPackageAuthoritySender {
  once(event: 'destroyed', listener: () => void): unknown
}

/** grant 服务子集：把一个 sender 授权路径解析为 canonical 形态并判定文件/目录。 */
export interface CanvasPackageAuthorityGrantResolver {
  resolveReadablePath(
    sender: CanvasPackageAuthoritySender,
    targetPath: string,
  ): { path: string; kind: 'file' | 'directory' }
}

export interface CanvasPackageAuthorityProject {
  status: 'active' | 'archived' | 'deleted'
  rootPath: string | null
}

export interface CanvasProjectPackageAuthorityDeps {
  /** 主应用窗口的 webContents（无窗口时为 null）。 */
  getMainAppSender(): CanvasPackageAuthoritySender | null
  /** 当前 Canvas 窗口的 webContents（无窗口时为 null）。 */
  getActiveCanvasSender(): CanvasPackageAuthoritySender | null
  /** 当前 Canvas 窗口正在展示的 projectId（无则 null）。 */
  getActiveProjectId(): string | null
  /** 按 id 查项目（DB 权威，含 status 与 root_path）。 */
  getProject(projectId: string): CanvasPackageAuthorityProject | null
  /** 仅接受 sender grant 的路径解析器。 */
  grants: CanvasPackageAuthorityGrantResolver
  /** 信任的默认 projects root（无需 grant）。 */
  getDefaultProjectsRoot(): string
  /** 把「已存在的目录」解析为 canonical；缺失或非目录返回 null（fail closed）。 */
  canonicalizeExistingDirectory(targetPath: string): string | null
}

export interface CanvasProjectPackageExportRequest {
  projectId: string
  targetParentDirectory: string
}

export interface CanvasProjectPackageExportAuthorization {
  projectId: string
  /** DB root_path 的 canonical 目录（唯一可信源目录）。 */
  sourceRootPath: string
  /** sender 目录 grant 的 canonical 路径，导出包写在其下。 */
  targetParentPath: string
}

export interface CanvasProjectPackageImportRequest {
  /** renderer 通过原生 open-directory dialog 选中的 v3 / legacy v2 包目录。 */
  sourceDirectory: string
  /** 目标父目录必须是可信默认 root 或 sender 目录 grant；缺省用默认 root。 */
  targetParentDirectory?: string
}

export interface CanvasProjectPackageImportAuthorization {
  /** sender 目录 grant 的 canonical 包目录。 */
  sourceRootPath: string
  /** 新项目导入的 canonical 目标父目录。 */
  targetParentPath: string
}

export class CanvasProjectPackageAuthority {
  constructor(private readonly deps: CanvasProjectPackageAuthorityDeps) {}

  authorizeExport(
    sender: CanvasPackageAuthoritySender,
    request: CanvasProjectPackageExportRequest,
  ): CanvasProjectPackageExportAuthorization {
    this.assertAuthorizedSender(sender, request.projectId)

    const project = this.deps.getProject(request.projectId)
    if (project == null || project.status !== 'active') {
      throw new Error('Canvas export requires an active project')
    }
    if (project.rootPath == null || project.rootPath.trim() === '') {
      throw new Error('Canvas export project has no directory root')
    }
    const sourceRootPath = this.deps.canonicalizeExistingDirectory(project.rootPath)
    if (sourceRootPath == null) {
      throw new Error('Canvas export project root is not an existing directory')
    }

    const targetParentPath = this.resolveGrantedDirectory(sender, request.targetParentDirectory)
    return { projectId: request.projectId, sourceRootPath, targetParentPath }
  }

  authorizeImport(
    sender: CanvasPackageAuthoritySender,
    request: CanvasProjectPackageImportRequest,
  ): CanvasProjectPackageImportAuthorization {
    this.assertAuthorizedSender(sender)
    const sourceRootPath = this.resolveGrantedDirectory(sender, request.sourceDirectory)
    const defaultProjectsRoot = this.resolveDefaultProjectsRoot()
    const requestedTarget = request.targetParentDirectory?.trim()
    const requestedCanonical = requestedTarget
      ? this.deps.canonicalizeExistingDirectory(requestedTarget)
      : null
    const targetParentPath =
      requestedTarget == null || requestedTarget === '' || requestedCanonical === defaultProjectsRoot
        ? defaultProjectsRoot
        : this.resolveGrantedDirectory(sender, requestedTarget)

    return { sourceRootPath, targetParentPath }
  }

  private assertAuthorizedSender(
    sender: CanvasPackageAuthoritySender,
    requestedProjectId?: string,
  ): void {
    if (this.deps.getMainAppSender() === sender) return

    if (this.deps.getActiveCanvasSender() !== sender) {
      throw new Error('Canvas package operation must originate from an authorized app window')
    }
    const activeProjectId = this.deps.getActiveProjectId()
    if (activeProjectId == null || activeProjectId === '') {
      throw new Error('Canvas package operation requires an active canvas project')
    }
    if (requestedProjectId != null && activeProjectId !== requestedProjectId) {
      throw new Error('Canvas package sender is not showing the requested project')
    }
    const activeProject = this.deps.getProject(activeProjectId)
    if (activeProject == null || activeProject.status !== 'active') {
      throw new Error('Canvas package operation requires an active canvas project')
    }
  }

  private resolveDefaultProjectsRoot(): string {
    const resolved = this.deps.canonicalizeExistingDirectory(
      this.deps.getDefaultProjectsRoot(),
    )
    if (resolved == null) {
      throw new Error('Canvas default projects root is not an existing directory')
    }
    return resolved
  }

  private resolveGrantedDirectory(
    sender: CanvasPackageAuthoritySender,
    targetPath: string,
  ): string {
    const resolved = this.deps.grants.resolveReadablePath(sender, targetPath)
    if (resolved.kind !== 'directory') {
      throw new Error('Canvas package target must be a granted directory')
    }
    return resolved.path
  }
}

/** realpath 一个已存在目录；缺失、无权限或非目录返回 null（fail closed）。 */
export function canonicalizeExistingDirectory(targetPath: string): string | null {
  try {
    const canonical = realpathSync.native(targetPath)
    return statSync(canonical).isDirectory() ? canonical : null
  } catch {
    return null
  }
}
