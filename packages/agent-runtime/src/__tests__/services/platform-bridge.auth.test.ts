import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request as httpRequest } from 'node:http'

import {
  PlatformBridgeService,
  type PlatformBridgeDeps,
} from '../../services/platform-bridge.service.js'

describe('PlatformBridgeService capability tokens', () => {
  let service: PlatformBridgeService
  let port = 0
  const canvasCall = vi.fn()

  beforeEach(async () => {
    canvasCall.mockReset().mockResolvedValue({ ok: true })
    service = new PlatformBridgeService()
    port = await service.start({
      sessionService: { bridgeCanvasToolCall: canvasCall },
    } as unknown as PlatformBridgeDeps)
  })

  afterEach(async () => {
    await service.stop()
  })

  function callRpc(
    method: string,
    params: Record<string, unknown>,
    token?: string,
  ): Promise<{ status: number; ok: boolean; data?: unknown; error?: string }> {
    const body = JSON.stringify({ method, params })
    return new Promise((resolve, reject) => {
      const headers: Record<string, string | number> = {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      }
      if (token != null) headers.authorization = `Bearer ${token}`
      const request = httpRequest(
        { host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            try {
              resolve({
                status: response.statusCode ?? 0,
                ...JSON.parse(Buffer.concat(chunks).toString('utf8')),
              })
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      request.on('error', reject)
      request.write(body)
      request.end()
    })
  }

  it('rejects requests without a bridge token', async () => {
    const result = await callRpc('canvas.call_tool', {
      sessionId: 'session-1',
      toolName: 'get_project',
      args: {},
    })

    expect(result).toMatchObject({ status: 401, ok: false })
    expect(canvasCall).not.toHaveBeenCalled()
  })

  it('allows only canvas.call_tool with a Canvas token', async () => {
    const token = service.createAccessToken('canvas', {
      sessionId: 'session-1',
      canvasToolNames: ['get_project'],
    })

    await expect(
      callRpc(
        'canvas.call_tool',
        { sessionId: 'session-1', toolName: 'get_project', args: {} },
        token,
      ),
    ).resolves.toMatchObject({ status: 200, ok: true })
    await expect(callRpc('agents.list', {}, token)).resolves.toMatchObject({
      status: 403,
      ok: false,
    })
  })

  it('does not let a Canvas token cross its session or approved tool set', async () => {
    const token = service.createAccessToken('canvas', {
      sessionId: 'session-1',
      canvasToolNames: ['get_project'],
    })

    await expect(
      callRpc(
        'canvas.call_tool',
        { sessionId: 'session-2', toolName: 'get_project', args: {} },
        token,
      ),
    ).resolves.toMatchObject({ status: 403, ok: false })
    await expect(
      callRpc(
        'canvas.call_tool',
        { sessionId: 'session-1', toolName: 'delete_board', args: {} },
        token,
      ),
    ).resolves.toMatchObject({ status: 403, ok: false })
    expect(canvasCall).not.toHaveBeenCalled()
  })

  it('does not let a legacy platform token invoke Canvas or Memory RPCs', async () => {
    const token = service.createAccessToken('platform', { sessionId: 'session-1' })

    await expect(
      callRpc(
        'canvas.call_tool',
        { sessionId: 'session-1', toolName: 'get_project', args: {} },
        token,
      ),
    ).resolves.toMatchObject({ status: 403, ok: false })
    await expect(
      callRpc('memory.search', { sessionId: 'session-1', query: 'secret' }, token),
    ).resolves.toMatchObject({ status: 403, ok: false })
    expect(canvasCall).not.toHaveBeenCalled()
  })

  it('revokes the previous token when a capability is renewed for one session', async () => {
    const first = service.createAccessToken('canvas', {
      sessionId: 'session-1',
      canvasToolNames: ['get_project'],
    })
    const current = service.createAccessToken('canvas', {
      sessionId: 'session-1',
      canvasToolNames: ['get_project'],
    })

    await expect(
      callRpc(
        'canvas.call_tool',
        { sessionId: 'session-1', toolName: 'get_project', args: {} },
        first,
      ),
    ).resolves.toMatchObject({ status: 401, ok: false })
    await expect(
      callRpc(
        'canvas.call_tool',
        { sessionId: 'session-1', toolName: 'get_project', args: {} },
        current,
      ),
    ).resolves.toMatchObject({ status: 200, ok: true })
  })
})
