import { SparkError } from '@spark/shared'
import {
  CanvasFileAccessGrantService,
  type CanvasFileAccessGrantSender,
  type CanvasReadablePath,
} from '../services/CanvasFileAccessGrantService.js'

/**
 * 原生文件对话框返回结果（Electron `OpenDialogReturnValue` 的最小可测子集）。
 * Controller 只依赖 canceled 与 filePaths，避免直接引入 Electron 类型。
 */
export interface CanvasOpenDialogResult {
  readonly canceled: boolean
  readonly filePaths: readonly string[]
}

/** 目录选择请求（透传给注入的 openDirectory 实现）。 */
export interface CanvasOpenDirectoryRequest {
  readonly title?: string
  readonly defaultPath?: string
}

/** 文件选择请求（透传给注入的 openFile 实现）。 */
export interface CanvasOpenFileRequest {
  readonly title?: string
  readonly defaultPath?: string
  readonly multiple?: boolean
  readonly allowDirectories?: boolean
  readonly filters?: ReadonlyArray<{ readonly name: string; readonly extensions: readonly string[] }>
}

/** `dialog:open-directory` 现有协议响应形状。 */
export interface CanvasOpenDirectoryResponse {
  readonly canceled: boolean
  readonly filePath?: string
}

/** `dialog:open-file` 现有协议响应形状。 */
export interface CanvasOpenFileResponse {
  readonly canceled: boolean
  readonly filePath?: string
  readonly filePaths?: string[]
}

/** `file:stat-kind` 现有协议响应类别。 */
export type CanvasFileStatKind = 'file' | 'directory' | 'absent'

/** `file:read-text` 现有协议响应形状。 */
export interface CanvasReadTextResponse {
  readonly content: string
}

/** 校验前的附件输入（image/file 为常规文件，directory 为目录）。 */
export interface CanvasFileAttachmentInput {
  readonly type: 'image' | 'file' | 'directory'
  readonly path: string
}

/** 校验后的附件：路径已归一化为 canonical 路径。 */
export interface CanvasValidatedAttachment {
  readonly type: 'image' | 'file' | 'directory'
  readonly path: string
}

/** stat 探测结果（null 表示路径缺失）。 */
export interface CanvasFileStat {
  isFile(): boolean
  isDirectory(): boolean
}

/**
 * Controller 的全部外部依赖。以注入方式提供，使 Controller 可在不加载 Electron
 * 的情况下被单测覆盖。
 */
export interface CanvasFileAccessControllerDeps {
  openDirectory(request: CanvasOpenDirectoryRequest): Promise<CanvasOpenDialogResult>
  openFile(request: CanvasOpenFileRequest): Promise<CanvasOpenDialogResult>
  /** 探测路径类别；缺失返回 null。不校验授权。 */
  stat(path: string): CanvasFileStat | null
  /** 读取 canonical 文本文件内容。 */
  readText(path: string): string
  /**
   * 解析该 sender 归属项目的可信 DB project root（绝无 renderer 提供的路径）。
   * 未绑定项目时返回 null。
   */
  resolveTrustedProjectRoot(sender: CanvasFileAccessGrantSender): string | null
}

function permissionDenied(message: string, path: string): SparkError {
  return new SparkError('PERMISSION_DENIED', message, { path })
}

/**
 * Canvas 文件访问控制器：在原生对话框、文件系统读取与 renderer 之间强制执行
 * per-sender grant 与可信 project root 边界。所有授权判定委托给
 * {@link CanvasFileAccessGrantService}，Controller 只负责编排注入依赖并把违规
 * 统一收敛为 {@link SparkError} PERMISSION_DENIED。
 */
export class CanvasFileAccessController {
  private readonly grants: CanvasFileAccessGrantService

  constructor(
    private readonly deps: CanvasFileAccessControllerDeps,
    grants: CanvasFileAccessGrantService = new CanvasFileAccessGrantService(),
  ) {
    this.grants = grants
  }

  /**
   * 弹出目录选择对话框；用户确认后把选中的全部路径 grant 给发起窗口，
   * 并返回 `dialog:open-directory` 的现有响应形状。
   */
  async openDirectory(
    sender: CanvasFileAccessGrantSender,
    request: CanvasOpenDirectoryRequest,
  ): Promise<CanvasOpenDirectoryResponse> {
    const result = await this.deps.openDirectory(request)
    this.grantSelected(sender, result)
    const first = result.filePaths[0]
    return {
      canceled: result.canceled,
      ...(first === undefined ? {} : { filePath: first }),
    }
  }

  /**
   * 弹出文件选择对话框；用户确认后把选中的全部路径 grant 给发起窗口，
   * 并返回 `dialog:open-file` 的现有响应形状。
   */
  async openFile(
    sender: CanvasFileAccessGrantSender,
    request: CanvasOpenFileRequest,
  ): Promise<CanvasOpenFileResponse> {
    const result = await this.deps.openFile(request)
    this.grantSelected(sender, result)
    const first = result.filePaths[0]
    return {
      canceled: result.canceled,
      ...(first === undefined ? {} : { filePath: first }),
      ...(result.filePaths.length > 0 ? { filePaths: [...result.filePaths] } : {}),
    }
  }

  /** Grant native paths extracted by the isolated preload from real dropped File objects. */
  grantDroppedPaths(sender: CanvasFileAccessGrantSender, paths: readonly string[]): string[] {
    if (this.deps.resolveTrustedProjectRoot(sender) == null) {
      throw permissionDenied('Dropped files require an active Canvas project window', paths[0] ?? '')
    }
    try {
      this.grants.grantSelectedPaths(sender, paths)
      return paths.map((path) => this.grants.resolveReadablePath(sender, path).path)
    } catch {
      throw permissionDenied('Dropped file path is not available to the requesting window', paths[0] ?? '')
    }
  }

  /**
   * 探测路径类别。仅允许可信 DB project root 或该 sender 的 grant：
   * 缺失返回 `absent`，未授权抛 PERMISSION_DENIED，授权则返回 `file`/`directory`。
   */
  statKind(sender: CanvasFileAccessGrantSender, targetPath: string): CanvasFileStatKind {
    const trustedRoot = this.deps.resolveTrustedProjectRoot(sender) ?? undefined
    if (!this.grants.isPathAllowed(sender, targetPath, trustedRoot)) {
      throw permissionDenied('File path is not authorized for the requesting window', targetPath)
    }
    if (this.deps.stat(targetPath) === null) return 'absent'
    try {
      return this.grants.resolveReadablePath(sender, targetPath, trustedRoot).kind
    } catch {
      throw permissionDenied('File path is not authorized for the requesting window', targetPath)
    }
  }

  /**
   * 读取文本文件：先经 grant 服务归一化并校验授权与 2 MiB 上限，再读取内容。
   */
  readText(sender: CanvasFileAccessGrantSender, targetPath: string): CanvasReadTextResponse {
    const trustedRoot = this.deps.resolveTrustedProjectRoot(sender) ?? undefined
    const canonicalPath = this.grants.resolveReadableTextFile(sender, targetPath, trustedRoot)
    return { content: this.deps.readText(canonicalPath) }
  }

  /**
   * 逐项校验附件：image/file 必须为常规文件，directory 必须为目录。
   * 返回 canonical 路径；未授权或类型不符抛 PERMISSION_DENIED。
   *
   * `projectRoot` 必须是调用方解析出的可信 DB project root，绝不能是 renderer
   * 上报的路径。
   */
  validateAttachments(
    sender: CanvasFileAccessGrantSender,
    projectRoot: string | undefined,
    attachments: readonly CanvasFileAttachmentInput[],
  ): CanvasValidatedAttachment[] {
    return attachments.map((attachment) => {
      const resolved = this.resolveGranted(sender, attachment.path, projectRoot, 'Attachment')
      const expectsDirectory = attachment.type === 'directory'
      if (expectsDirectory ? resolved.kind !== 'directory' : resolved.kind !== 'file') {
        throw permissionDenied(
          `Attachment type '${attachment.type}' does not match the resolved path kind`,
          attachment.path,
        )
      }
      return { type: attachment.type, path: resolved.path }
    })
  }

  /**
   * 解析媒体复制源：仅允许常规文件，返回 canonical 路径。
   * 未授权或非常规文件抛 PERMISSION_DENIED。
   *
   * `projectRoot` 必须是可信 DB project root，绝不能是 renderer 上报的路径。
   */
  resolveReadableFile(
    sender: CanvasFileAccessGrantSender,
    targetPath: string,
    projectRoot?: string,
  ): string {
    const resolved = this.resolveGranted(sender, targetPath, projectRoot, 'Media')
    if (resolved.kind !== 'file') {
      throw permissionDenied('Media path must resolve to a regular file', targetPath)
    }
    return resolved.path
  }

  private grantSelected(sender: CanvasFileAccessGrantSender, result: CanvasOpenDialogResult): void {
    if (result.canceled || result.filePaths.length === 0) return
    this.grants.grantSelectedPaths(sender, result.filePaths)
  }

  private resolveGranted(
    sender: CanvasFileAccessGrantSender,
    targetPath: string,
    projectRoot: string | undefined,
    label: string,
  ): CanvasReadablePath {
    try {
      return this.grants.resolveReadablePath(sender, targetPath, projectRoot)
    } catch {
      throw permissionDenied(`${label} path is not authorized for the requesting window`, targetPath)
    }
  }
}
