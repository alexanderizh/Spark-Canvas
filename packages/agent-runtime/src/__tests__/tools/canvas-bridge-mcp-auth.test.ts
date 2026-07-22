import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const CANVAS_SERVER = fileURLToPath(
  new URL('../../tools/spark-canvas-mcp-server.mjs', import.meta.url),
)
const MEMORY_SERVER = fileURLToPath(
  new URL('../../tools/spark-memory-mcp-server.mjs', import.meta.url),
)

describe('Canvas runtime MCP bridge authentication', () => {
  let child: ChildProcessWithoutNullStreams | null = null
  let bridge: Server | null = null

  afterEach(async () => {
    if (child != null && !child.killed) child.kill()
    if (bridge != null) {
      await new Promise<void>((resolve) => bridge?.close(() => resolve()))
      bridge = null
    }
  })

  async function startBridge(): Promise<{
    port: number
    request: Promise<{ authorization: string; body: Record<string, unknown> }>
  }> {
    let resolveRequest: (value: { authorization: string; body: Record<string, unknown> }) => void
    const request = new Promise<{ authorization: string; body: Record<string, unknown> }>(
      (resolve) => {
        resolveRequest = resolve
      },
    )
    bridge = createServer((incoming, response) => {
      const chunks: Buffer[] = []
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
      incoming.on('end', () => {
        resolveRequest({
          authorization: incoming.headers.authorization ?? '',
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, data: { hits: [], related: [] } }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (address == null || typeof address === 'string') throw new Error('Bridge bind failed')
        resolve(address.port)
      })
    })
    return { port, request }
  }

  it('sends the scoped token from spark_canvas', async () => {
    const { port, request } = await startBridge()
    child = spawn(process.execPath, [CANVAS_SERVER], {
      env: {
        ...process.env,
        SPARK_PLATFORM_BRIDGE_PORT: String(port),
        SPARK_CANVAS_BRIDGE_TOKEN: 'canvas-token',
        SPARK_CANVAS_SID: 'session-1',
        SPARK_CANVAS_TOOL_SCHEMAS_JSON: JSON.stringify([
          { name: 'get_project', description: 'Read project', inputSchema: { type: 'object' } },
        ]),
      },
    })

    const response = callMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_project', arguments: {} },
    })

    await expect(request).resolves.toMatchObject({
      authorization: 'Bearer canvas-token',
      body: { method: 'canvas.call_tool' },
    })
    await expect(response).resolves.toMatchObject({ id: 1, result: expect.any(Object) })
  })

  it('sends the scoped token from spark_memory', async () => {
    const { port, request } = await startBridge()
    child = spawn(process.execPath, [MEMORY_SERVER], {
      env: {
        ...process.env,
        SPARK_PLATFORM_BRIDGE_PORT: String(port),
        SPARK_MEMORY_BRIDGE_TOKEN: 'memory-token',
        SPARK_MEMORY_SID: 'session-1',
      },
    })

    const response = callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'search_memory', arguments: { query: 'film style' } },
    })

    await expect(request).resolves.toMatchObject({
      authorization: 'Bearer memory-token',
      body: { method: 'memory.search' },
    })
    await expect(response).resolves.toMatchObject({ id: 2, result: expect.any(Object) })
  })
})

function callMcp(
  child: ChildProcessWithoutNullStreams,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP call timed out')), 8_000)
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.id === request.id) {
          clearTimeout(timer)
          child.stdout.off('data', onData)
          resolve(message)
        }
      }
    }
    child.stdout.on('data', onData)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}
