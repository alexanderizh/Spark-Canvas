import { describe, expect, it, vi } from 'vitest'
import { createCanvasTaskLifecycleLog } from './canvas-task-lifecycle-log.js'

describe('createCanvasTaskLifecycleLog', () => {
  it('keeps the same canvas task correlation fields from start to completion', () => {
    const info = vi.fn()
    const warn = vi.fn()
    const error = vi.fn()
    const taskLog = createCanvasTaskLifecycleLog(
      {
        kind: 'media',
        projectId: 'project-1',
        clientTaskId: 'canvas_task_1',
        operation: 'text_to_video',
        providerProfileId: 'apimart-1',
        modelId: 'doubao-seedance-1-5-pro',
        background: true,
        inputCount: 1,
      },
      { logger: { info, warn, error }, now: () => 1_000 },
    )

    taskLog.started()
    taskLog.submitted({
      runtimeTaskId: 'runtime-1',
      providerRequestId: 'task_01ABC',
      response: { task_id: 'task_01ABC', status: 'queued' },
    })
    taskLog.settled({
      status: 'succeeded',
      runtimeTaskId: 'runtime-1',
      providerRequestId: 'task_01ABC',
      assetCount: 1,
    })

    expect(info).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(
        'event=started kind=media projectId=project-1 clientTaskId=canvas_task_1 operation=text_to_video',
      ),
    )
    const submitted = String(info.mock.calls[1]?.[0])
    expect(submitted).toContain('event=provider-submitted')
    expect(submitted).toContain('providerRequestId=task_01ABC')
    expect(submitted).toContain('response={"task_id":"task_01ABC","status":"queued"}')
    const finished = String(info.mock.calls[2]?.[0])
    expect(finished).toContain(
      'event=finished kind=media projectId=project-1 clientTaskId=canvas_task_1 operation=text_to_video',
    )
    expect(finished).toContain(
      'status=succeeded runtimeTaskId=runtime-1 providerRequestId=task_01ABC',
    )
    expect(finished).toContain('assets=1 elapsedMs=0')
  })

  it('logs terminal failures at warn level with a bounded single-line message', () => {
    const info = vi.fn()
    const warn = vi.fn()
    const error = vi.fn()
    const taskLog = createCanvasTaskLifecycleLog(
      {
        kind: 'text',
        projectId: 'project-2',
        clientTaskId: 'canvas_task_2',
        operation: 'text_generate',
        background: false,
      },
      { logger: { info, warn, error }, now: () => 2_000 },
    )

    const signedUrl = 'https://uploads.spark.example/private.png?X-Amz-Signature=secret'
    taskLog.settled({
      status: 'failed',
      error: {
        code: 'provider_http_error',
        message: `line one\n${signedUrl}\n${'x'.repeat(600)}`,
      },
    })

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('event=failed')
    expect(message).toContain('code=provider_http_error')
    expect(message).toContain('messageChars=500')
    expect(message).not.toContain('line one')
    expect(message).not.toContain(signedUrl)
    expect(message).not.toContain('\n')
    expect(message.length).toBeLessThan(900)
  })

  it('redacts signed URLs and base64 payloads from provider submission logs', () => {
    const info = vi.fn()
    const secretQuery = 'X-Amz-Signature=private-signature'
    const base64Payload = 'c2Vuc2l0aXZlLWltYWdlLWJ5dGVz'
    const taskLog = createCanvasTaskLifecycleLog(
      {
        kind: 'media',
        projectId: 'project-3',
        operation: 'image_to_video',
        background: true,
      },
      { logger: { info, warn: vi.fn(), error: vi.fn() }, now: () => 3_000 },
    )

    taskLog.submitted({
      providerRequestId: 'task_03ABC',
      response: {
        outputUrl: `https://uploads.spark.example/output.png?${secretQuery}`,
        source: { type: 'base64', media_type: 'image/png', data: base64Payload },
      },
    })

    const message = String(info.mock.calls[0]?.[0])
    expect(message).toContain('https://uploads.spark.example/output.png?[REDACTED]')
    expect(message).toContain('[base64')
    expect(message).not.toContain(secretQuery)
    expect(message).not.toContain(base64Payload)
  })
})
