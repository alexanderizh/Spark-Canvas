/**
 * IPC Handler 注册完整性测试
 *
 * 验证 Canvas allowlist 中的每个 channel 都在 main 进程某处有对应 handler。
 * 不依赖 Electron 运行时，直接静态分析注册代码。
 *
 * 扫描范围：main/ipc/ + main/services/，排除 __tests__ 子目录和 *.test.ts。
 * 这样 registerTerminalIpc.ts / registerAuthIpc.ts 这类拆分出来的注册文件都能被覆盖到。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { CANVAS_INVOKE_CHANNELS } from '../../../shared/canvasIpcPolicy.js'

const MAIN_IPC_DIR = join(__dirname, '..')
const MAIN_SERVICES_DIR = join(__dirname, '../../services')

function readAllTsUnder(dir: string): string {
  let out = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out += readAllTsUnder(full)
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out += readFileSync(full, 'utf-8') + '\n'
    }
  }
  return out
}

function extractChannels(src: string): string[] {
  const matches = src.match(/'[a-z][a-z-]*(?::[a-z][a-z-]*)+'/g) ?? []
  return [...new Set(matches.map((m) => m.slice(1, -1)))]
}

describe('IPC handler registration completeness', () => {
  // 拼接：main/ipc 与 main/services（很多 register*.ts 在 services 目录下）
  const handlerSrc = readAllTsUnder(MAIN_IPC_DIR) + '\n' + readAllTsUnder(MAIN_SERVICES_DIR)
  const definedChannels = [...CANVAS_INVOKE_CHANNELS]

  // Extract channels registered via typedIpcHandle in handlers
  const registeredChannels = extractChannels(handlerSrc)

  it('keeps the reviewed Canvas invoke inventory', () => {
    expect(definedChannels).toHaveLength(118)
  })

  it('every Canvas invoke channel has a registered handler', () => {
    const missing = definedChannels.filter((ch) => !registeredChannels.includes(ch))
    expect(missing, `Missing handlers for: ${missing.join(', ')}`).toHaveLength(0)
  })

  it('all expected namespaces are covered', () => {
    const namespaces = [...new Set(definedChannels.map((ch) => ch.split(':')[0]))]
    expect(namespaces.sort()).toEqual(
      [
        'app',
        'auth',
        'canvas',
        'dialog',
        'ffmpeg',
        'file',
        'model',
        'platform-model',
        'provider',
        'settings',
        'tool',
        'update',
        'video',
        'window',
      ].sort(),
    )
  })
})
