import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import electronViteConfig from '../electron.vite.config'

const ROOT = join(__dirname, '..')
const MIGRATIONS_DIR = join(ROOT, '../../packages/storage/migrations')
const OUTPUT_TOOLS_DIR = join(ROOT, 'out/main/tools')
const OUTPUT_MEDIA_DIR = join(ROOT, 'out/main/services/media')
const MEDIA_HELPERS = ['media-extract.mjs', 'media-request-compiler.mjs']
const CANVAS_RUNTIME_TOOLS = [
  'image-generation-mcp-server.mjs',
  'media-generation-mcp-server.mjs',
  'platform-management-mcp-server.mjs',
  'present-files-mcp-server.mjs',
  'spark-canvas-mcp-server.mjs',
  'spark-memory-mcp-server.mjs',
]

describe('desktop runtime assets', () => {
  it('watches the migrations directory so newly added migrations trigger a rebuild', () => {
    const config = electronViteConfig as {
      main?: {
        plugins?: Array<{
          name?: string
          buildStart?: (this: { addWatchFile: (path: string) => void }) => void
        }>
      }
    }
    const migrationsPlugin = config.main?.plugins?.find(
      (plugin) => plugin.name === 'copy-migrations',
    )
    const watchedFiles: string[] = []

    expect(migrationsPlugin?.buildStart).toBeTypeOf('function')
    migrationsPlugin?.buildStart?.call({ addWatchFile: (path) => watchedFiles.push(path) })

    expect(watchedFiles).toContain(MIGRATIONS_DIR)
    expect(watchedFiles.some((path) => path.endsWith('.sql'))).toBe(true)
  })

  it('copies the spark_media import closure and starts the built MCP server', () => {
    mkdirSync(OUTPUT_TOOLS_DIR, { recursive: true })
    writeFileSync(join(OUTPUT_TOOLS_DIR, 'web-search-mcp-server.mjs'), 'stale')
    for (const helper of MEDIA_HELPERS) {
      rmSync(join(OUTPUT_MEDIA_DIR, helper), { force: true })
    }

    const config = electronViteConfig as {
      main?: {
        plugins?: Array<{
          name?: string
          buildStart?: (this: { addWatchFile: (path: string) => void }) => void
          writeBundle?: () => void
        }>
      }
    }
    const runtimeToolsPlugin = config.main?.plugins?.find(
      (plugin) => plugin.name === 'copy-runtime-tools',
    )

    const watchedFiles: string[] = []
    expect(runtimeToolsPlugin?.buildStart).toBeTypeOf('function')
    runtimeToolsPlugin?.buildStart?.call({ addWatchFile: (path) => watchedFiles.push(path) })
    expect(watchedFiles.map((path) => path.split('/').pop()).sort()).toEqual(
      [...CANVAS_RUNTIME_TOOLS, ...MEDIA_HELPERS].sort(),
    )

    expect(runtimeToolsPlugin?.writeBundle).toBeTypeOf('function')
    runtimeToolsPlugin?.writeBundle?.()

    expect(
      readdirSync(OUTPUT_TOOLS_DIR)
        .filter((file) => file.endsWith('.mjs'))
        .sort(),
    ).toEqual(CANVAS_RUNTIME_TOOLS)
    for (const helper of MEDIA_HELPERS) {
      expect(existsSync(join(OUTPUT_MEDIA_DIR, helper)), helper).toBe(true)
    }

    const serverPath = join(ROOT, 'out/main/tools/media-generation-mcp-server.mjs')
    const processResult = spawnSync(process.execPath, [serverPath], {
      cwd: ROOT,
      encoding: 'utf8',
      input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`,
    })

    expect(processResult.stderr).toBe('')
    expect(processResult.status).toBe(0)
    expect(JSON.parse(processResult.stdout.trim())).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: { name: 'spark-media' },
      },
    })
  })
})
