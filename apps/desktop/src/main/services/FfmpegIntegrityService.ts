/**
 * FfmpegIntegrityService — FFmpeg 二进制完整性检测
 *
 * 职责：
 *   1. 检测 ffmpeg/ffprobe 是否可用（managed 目录优先 → 系统 PATH 回退）
 *   2. 暴露二进制路径供 FfmpegRunner 使用
 *
 * 模式：参考 `PlaywrightIntegrityService.ts`（状态缓存 + 检测 + 安装 + 二次校验）
 * 检测范式参考 `ExternalToolService.ts` / `ShellEnvironmentService.ts`（which/where + 版本解析）
 *
 * 托管版本只读取 `{userData}/bin/ffmpeg/active.json` 指向的当前产品版本，
 * 不扫描或复用旧 Spark 的通用 binary 目录。
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { createLogger } from '@spark/shared'

const log = createLogger('ffmpeg-integrity')
const execFileAsync = promisify(execFile)

const isWin = process.platform === 'win32'
const FFMPEG_EXE = isWin ? 'ffmpeg.exe' : 'ffmpeg'
const FFPROBE_EXE = isWin ? 'ffprobe.exe' : 'ffprobe'

export interface FfmpegIntegrityState {
  ffmpegReady: boolean
  /** 'managed' = 我们从 minio 下载的；'system' = 用户系统 PATH 里的；'none' = 不可用 */
  ffmpegSource: 'managed' | 'system' | 'none'
  ffmpegVersion: string | null
  ffprobeReady: boolean
  /** ffmpeg 可执行文件绝对路径（供 FfmpegRunner 使用） */
  binaryPath: string | null
  /** ffprobe 可执行文件绝对路径 */
  ffprobePath: string | null
  lastError: string | null
}

let cachedState: FfmpegIntegrityState | null = null
/** in-flight 检测去重：并发调用 detectFfmpegIntegrity 只跑一次实际检测 */
let detectInFlight: Promise<FfmpegIntegrityState> | null = null

// ─── Path Resolution ────────────────────────────────────────────────────────

/** `{userData}/bin` —— Spark Canvas 本地二进制根目录。 */
function getBinaryRootDir(): string {
  return join(app.getPath('userData'), 'bin')
}

interface ManagedFfmpegActiveManifest {
  schemaVersion: 1
  product: 'spark-canvas'
  version: string
  platform: string
  arch: string
}

/** 只解析 Spark Canvas 自己的 active manifest，不扫描任意旧 binary 目录。 */
export function resolveManagedBinaryDir(
  binaryRoot = getBinaryRootDir(),
  platform = process.platform,
  arch = process.arch,
): string | null {
  const managedRoot = join(binaryRoot, 'ffmpeg')
  try {
    const manifest = JSON.parse(
      readFileSync(join(managedRoot, 'active.json'), 'utf8'),
    ) as Partial<ManagedFfmpegActiveManifest>
    if (
      manifest.schemaVersion !== 1 ||
      manifest.product !== 'spark-canvas' ||
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      typeof manifest.version !== 'string' ||
      !/^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(manifest.version)
    ) {
      return null
    }
    const versionDir = join(managedRoot, manifest.version, `${platform}-${arch}`)
    if (!existsSync(join(versionDir, FFMPEG_EXE)) || !existsSync(join(versionDir, FFPROBE_EXE))) {
      return null
    }
    return versionDir
  } catch {
    return null
  }
}

// ─── Version Detection ──────────────────────────────────────────────────────

/** 从 `ffmpeg -version` 首行解析版本号，格式：`ffmpeg version 7.0.2 ...` */
const FFMPEG_VERSION_REGEX = /^ff(?:mpeg|probe) version (\S+)/

/**
 * 执行 `<bin> -version` 拿版本号。ffmpeg/ffprobe 都支持 -version。
 * 超时 5s，失败返回 null。
 */
async function readBinaryVersion(binPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binPath, ['-version'], { timeout: 5000 })
    const m = stdout.match(FFMPEG_VERSION_REGEX)
    return m?.[1] ?? null
  } catch (err) {
    log.warn(`readBinaryVersion failed for ${binPath}: ${String(err)}`)
    return null
  }
}

/**
 * 检测系统 PATH 里的 ffmpeg（用户自己装的）。
 * 用 which/where 定位后跑 -version 拿版本。
 */
async function detectSystemFfmpeg(): Promise<{
  path: string
  version: string
} | null> {
  try {
    const whichCmd = isWin ? 'where' : 'which'
    const { stdout } = await execFileAsync(whichCmd, ['ffmpeg'], { timeout: 3000 })
    const path = stdout.trim().split(/[\r\n]/)[0]
    if (!path) return null
    const version = await readBinaryVersion(path)
    // version 为 null 说明 ffmpeg 虽存在但无法正常执行（如 dyld 库缺失崩溃），
    // 视为不可用——否则会误判 ffmpegReady=true 但实际所有操作都失败。
    if (!version) return null
    return { path, version }
  } catch {
    return null
  }
}

/** 探测系统 PATH 里的 ffprobe，并确认它能正常返回版本。 */
async function detectSystemFfprobe(): Promise<{ path: string; version: string } | null> {
  try {
    const whichCmd = isWin ? 'where' : 'which'
    const { stdout } = await execFileAsync(whichCmd, ['ffprobe'], { timeout: 3000 })
    const path = stdout.trim().split(/[\r\n]/)[0]
    if (!path) return null
    const version = await readBinaryVersion(path)
    return version ? { path, version } : null
  } catch {
    return null
  }
}

export function isCompatibleFfmpegPair(
  ffmpeg: { path: string; version: string },
  ffprobe: { path: string; version: string },
): boolean {
  return (
    dirname(resolve(ffmpeg.path)) === dirname(resolve(ffprobe.path)) &&
    ffmpeg.version === ffprobe.version
  )
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * 返回当前 ffmpeg/ffprobe 可执行文件路径，供 FfmpegRunner 使用。
 * 不刷新缓存（用 detectFfmpegIntegrity 刷新）。
 * 找不到时抛错——调用方应在调用前确保 ffmpegReady。
 */
export async function resolveFfmpegBin(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const state = cachedState ?? (await detectFfmpegIntegrity())
  if (!state.ffmpegReady || !state.binaryPath || !state.ffprobePath) {
    throw new Error(
      'FFmpeg 不可用。请在「设置 → 完整性」中下载 FFmpeg，或确认系统已安装 ffmpeg 并在 PATH 中。',
    )
  }
  return { ffmpeg: state.binaryPath, ffprobe: state.ffprobePath }
}

/** 同步返回缓存状态（未检测时返回 null）。 */
export function getCachedFfmpegIntegrity(): FfmpegIntegrityState | null {
  return cachedState
}

/**
 * 检测当前 ffmpeg 完整性状态，刷新缓存并返回。
 *
 * 优先级：managed 目录 > 系统 PATH > none。
 * 并发安全：多次调用共享同一个 in-flight promise，避免检测风暴。
 */
export function detectFfmpegIntegrity(): Promise<FfmpegIntegrityState> {
  if (detectInFlight) return detectInFlight
  detectInFlight = doDetectFfmpegIntegrity().finally(() => {
    detectInFlight = null
  })
  return detectInFlight
}

async function doDetectFfmpegIntegrity(): Promise<FfmpegIntegrityState> {
  // 1. Spark Canvas managed active 目录
  const managedDir = resolveManagedBinaryDir()
  if (managedDir) {
    const ffmpegPath = join(managedDir, FFMPEG_EXE)
    const ffprobePath = join(managedDir, FFPROBE_EXE)
    if (existsSync(ffmpegPath) && existsSync(ffprobePath)) {
      const [version, ffprobeVersion] = await Promise.all([
        readBinaryVersion(ffmpegPath),
        readBinaryVersion(ffprobePath),
      ])
      if (
        version &&
        ffprobeVersion &&
        isCompatibleFfmpegPair(
          { path: ffmpegPath, version },
          { path: ffprobePath, version: ffprobeVersion },
        )
      ) {
        const state: FfmpegIntegrityState = {
          ffmpegReady: true,
          ffmpegSource: 'managed',
          ffmpegVersion: version,
          ffprobeReady: true,
          binaryPath: ffmpegPath,
          ffprobePath,
          lastError: cachedState?.lastError ?? null,
        }
        cachedState = state
        return state
      }
    }
  }

  // 2. 系统 PATH
  const systemFfmpeg = await detectSystemFfmpeg()
  if (systemFfmpeg?.version) {
    const systemFfprobe = await detectSystemFfprobe()
    if (systemFfprobe && isCompatibleFfmpegPair(systemFfmpeg, systemFfprobe)) {
      const state: FfmpegIntegrityState = {
        ffmpegReady: true,
        ffmpegSource: 'system',
        ffmpegVersion: systemFfmpeg.version,
        ffprobeReady: true,
        binaryPath: systemFfmpeg.path,
        ffprobePath: systemFfprobe.path,
        lastError: cachedState?.lastError ?? null,
      }
      cachedState = state
      return state
    }
  }

  // 3. 不可用
  const state: FfmpegIntegrityState = {
    ffmpegReady: false,
    ffmpegSource: 'none',
    ffmpegVersion: null,
    ffprobeReady: false,
    binaryPath: null,
    ffprobePath: null,
    lastError: cachedState?.lastError ?? null,
  }
  cachedState = state
  return state
}

/** 重置缓存。安装失败后强制下次重新检测。 */
export function invalidateFfmpegCache(): void {
  cachedState = null
}
