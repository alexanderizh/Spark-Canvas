import { SparkError } from '@spark/shared'
import {
  resolveCanvasProjectRoot,
  type CanvasProjectRootAuthorityResult,
} from '../services/CanvasProjectRootAuthority.js'

/**
 * canvas 项目目录准备的可测试协调器。
 *
 * 背景漏洞：canvas:snapshot:save / canvas:project:ensure-directory 直接把 renderer 传来的
 * rootPath / parentDirectory 透传给 ensureCanvasProjectDirectory，可被用于把已存在项目静默迁移到
 * 任意目录，或让新项目逃逸出受控的 projects 根。本协调器把 {@link resolveCanvasProjectRoot} 的
 * 权威判定与副作用（DB 查询、授权判定、建目录）通过依赖注入串起来：只有拿到已授权的值才交给
 * ensureDirectory；权威边界拒绝时统一抛 PERMISSION_DENIED，绝不把原始 renderer 字符串继续透传。
 */

/** renderer 侧发来的目录准备请求（sender 用于授权判定，不做隐式信任）。 */
export interface CanvasProjectDirectoryRequest {
  sender: unknown
  projectId: string
  title?: string
  /** renderer 请求的精确项目根（对应 ensureCanvasProjectDirectory 的 rootPath）。 */
  requestedRootPath?: string | null
  /** renderer 请求的父目录容器（对应 ensureCanvasProjectDirectory 的 parentDirectory）。 */
  requestedParentDirectory?: string | null
}

/** 已通过权威判定、可以安全落盘的目录入参。 */
export interface AuthorisedEnsureDirectoryInput {
  projectId: string
  title?: string
  rootPath?: string
  parentDirectory?: string
}

/** DB 中项目记录里协调器关心的最小形状。 */
export interface CanvasProjectDirectoryRecord {
  root_path: string | null
}

export interface CanvasProjectDirectoryCoordinatorDependencies<TResult> {
  /** 按 projectId 查库；返回 null 表示新项目。 */
  findProject(projectId: string): CanvasProjectDirectoryRecord | null
  /** 受控的默认 projects 根；位于其内的请求路径无需额外授权。 */
  defaultProjectsRoot(): string
  /** 对某条外部路径返回 true 表示该 sender 已被用户显式授权。 */
  isGranted(sender: unknown, candidatePath: string): boolean
  /** 拿到已授权入参后真正建目录（副作用）；协调器原样返回其结果。 */
  ensureDirectory(input: AuthorisedEnsureDirectoryInput): Promise<TResult>
}

function toAuthorisedInput(
  request: CanvasProjectDirectoryRequest,
  authority: Extract<CanvasProjectRootAuthorityResult, { ok: true }>,
): AuthorisedEnsureDirectoryInput {
  const input: AuthorisedEnsureDirectoryInput = { projectId: request.projectId }
  // exactOptionalPropertyTypes: true —— 仅在有值时挂载可选属性，避免 undefined 覆盖默认分支。
  if (request.title !== undefined) input.title = request.title
  if (authority.rootPath !== undefined) input.rootPath = authority.rootPath
  if (authority.parentDirectory !== undefined) input.parentDirectory = authority.parentDirectory
  return input
}

/**
 * 解析并落盘 canvas 项目目录。
 *
 * 1. 用 findProject 取 DB 权威根（已存在项目）。
 * 2. 交给 resolveCanvasProjectRoot 判权威边界；grant 判定绑定当前 sender。
 * 3. 被拒绝 → 抛 SparkError('PERMISSION_DENIED')。
 * 4. 通过 → 用已授权入参调用 ensureDirectory 并原样返回其结果。
 */
export async function coordinateCanvasProjectDirectory<TResult>(
  request: CanvasProjectDirectoryRequest,
  dependencies: CanvasProjectDirectoryCoordinatorDependencies<TResult>,
): Promise<TResult> {
  const project = dependencies.findProject(request.projectId)

  const authority = resolveCanvasProjectRoot({
    existingRootPath: project?.root_path ?? null,
    requestedRootPath: request.requestedRootPath ?? null,
    requestedParentDirectory: request.requestedParentDirectory ?? null,
    defaultProjectsRoot: dependencies.defaultProjectsRoot(),
    isGranted: (candidatePath) => dependencies.isGranted(request.sender, candidatePath),
  })

  if (!authority.ok) {
    throw new SparkError('PERMISSION_DENIED', '当前窗口无权在该目录准备画布项目。', {
      projectId: request.projectId,
      reason: authority.reason,
    })
  }

  return dependencies.ensureDirectory(toAuthorisedInput(request, authority))
}
