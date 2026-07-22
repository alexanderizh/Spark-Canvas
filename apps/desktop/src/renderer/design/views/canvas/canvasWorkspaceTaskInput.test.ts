// @vitest-environment jsdom

import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCanvasInputBindingsForRoles,
  buildPipelineSourceText,
  materializeCanvasTaskInputFiles,
  resolveCanvasInputTransport,
  resolveCanvasPipelineTextSource,
} from './canvasWorkspaceTaskInput'
import type { CanvasAsset, CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'

const invoke = vi.fn()

function safeFileUrl(filePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(filePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

describe('canvas workspace task input transport', () => {
  beforeEach(() => {
    invoke.mockReset()
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
    vi.unstubAllGlobals()
  })

  it('defaults automatic and unspecified transport to local base64', () => {
    expect(resolveCanvasInputTransport('auto')).toBe('base64')
    expect(resolveCanvasInputTransport(undefined)).toBe('base64')
    expect(resolveCanvasInputTransport('base64')).toBe('base64')
    expect(resolveCanvasInputTransport('cloud_url')).toBe('cloud_url')
  })

  it('uploads local video and audio inputs for explicit cloud_url transport', async () => {
    invoke
      .mockResolvedValueOnce({
        fileName: 'canvas-input-1.mp4',
        fileKey: 'video-key',
        staticUrl: 'https://spark.example/video.mp4',
        aiUrl: 'https://spark.example/ai/video.mp4',
      })
      .mockResolvedValueOnce({
        fileName: 'canvas-input-2.mp3',
        fileKey: 'audio-key',
        staticUrl: 'https://spark.example/audio.mp3',
        aiUrl: 'https://spark.example/ai/audio.mp3',
      })
    const files: CanvasMediaTaskInputFile[] = [
      {
        type: 'video',
        role: 'input',
        url: safeFileUrl('/tmp/shot.mp4'),
        mimeType: 'video/mp4',
      },
      {
        type: 'audio',
        role: 'input',
        url: safeFileUrl('/tmp/voice.mp3'),
        mimeType: 'audio/mpeg',
      },
    ]

    const result = await materializeCanvasTaskInputFiles(files, 'cloud_url')

    expect(invoke).toHaveBeenNthCalledWith(1, 'auth:upload-file', {
      filePath: '/tmp/shot.mp4',
      fileName: 'canvas-input-1.mp4',
      mimeType: 'video/mp4',
    })
    expect(invoke).toHaveBeenNthCalledWith(2, 'auth:upload-file', {
      filePath: '/tmp/voice.mp3',
      fileName: 'canvas-input-2.mp3',
      mimeType: 'audio/mpeg',
    })
    expect(result).toEqual([
      {
        type: 'video',
        role: 'input',
        url: 'https://spark.example/ai/video.mp4',
        mimeType: 'video/mp4',
      },
      {
        type: 'audio',
        role: 'input',
        url: 'https://spark.example/ai/audio.mp3',
        mimeType: 'audio/mpeg',
      },
    ])
  })

  it('uses the provider-compatible extension for an M4V input', async () => {
    invoke.mockResolvedValue({
      fileName: 'canvas-input-1.m4v',
      fileKey: 'm4v-key',
      staticUrl: 'https://spark.example/clip.m4v',
      aiUrl: 'https://spark.example/ai/clip.m4v',
    })

    await materializeCanvasTaskInputFiles(
      [
        {
          type: 'video',
          role: 'input',
          url: safeFileUrl('/tmp/clip.m4v'),
          mimeType: 'video/x-m4v',
        },
      ],
      'cloud_url',
    )

    expect(invoke).toHaveBeenCalledWith(
      'auth:upload-file',
      expect.objectContaining({ fileName: 'canvas-input-1.m4v' }),
    )
  })

  it('materializes local media as base64 in auto mode without contacting Spark', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['clip'], { type: 'video/mp4' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const files: CanvasMediaTaskInputFile[] = [
      {
        type: 'video',
        role: 'input',
        url: safeFileUrl('/tmp/clip.mp4'),
        mimeType: 'video/mp4',
      },
    ]

    const result = await materializeCanvasTaskInputFiles(files, 'auto')

    expect(invoke).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledWith(files[0]?.url)
    expect(result).toEqual([
      {
        type: 'video',
        role: 'input',
        dataUrl: 'data:video/mp4;base64,Y2xpcA==',
        mimeType: 'video/mp4',
      },
    ])
    expect(JSON.stringify(result)).not.toContain('safe-file://')
  })

  it('fails explicit cloud_url materialization without leaking a local URL fallback', async () => {
    const uploadError = new Error('Spark upload unavailable')
    invoke.mockRejectedValue(uploadError)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const files: CanvasMediaTaskInputFile[] = [
      {
        type: 'image',
        role: 'reference',
        url: safeFileUrl('/tmp/reference.webp'),
        mimeType: 'image/webp',
      },
    ]

    await expect(materializeCanvasTaskInputFiles(files, 'cloud_url')).rejects.toBe(uploadError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

const at = '2026-07-16T00:00:00.000Z'

function operationNode(): CanvasNode {
  return {
    id: 'operation-screenplay',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text_rewrite',
    taskId: 'task-screenplay',
    title: '转剧本',
    x: 0,
    y: 0,
    width: 420,
    height: 320,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {
      operation: 'text_rewrite',
      status: 'completed',
      outputPipelineRole: 'screenplay',
    },
    createdAt: at,
    updatedAt: at,
  }
}

function screenplayAsset(): CanvasAsset {
  return {
    id: 'asset-screenplay',
    projectId: 'project-1',
    userId: 1,
    type: 'text',
    source: 'ai_generated',
    title: '转剧本结果',
    contentText: '场 1：雨夜车站\n林岚走入候车厅。',
    metadata: { taskId: 'task-screenplay' },
    createdAt: at,
    updatedAt: at,
  }
}

function screenplayTask(outputNodeIds: string[]): CanvasTask {
  return {
    id: 'task-screenplay',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    operation: 'text_rewrite',
    status: 'completed',
    progress: 100,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds,
    outputAssetIds: ['asset-screenplay'],
    modelParams: {},
    createdAt: at,
    updatedAt: at,
  }
}

function snapshotWith(nodes: CanvasNode[], task: CanvasTask): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: nodes.length,
      assetCount: 1,
      taskCount: 1,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 1,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes,
    edges: [],
    assets: [screenplayAsset()],
    tasks: [task],
  }
}

describe('resolveCanvasPipelineTextSource', () => {
  it('persists true keyframes as endpoints and design images as references', () => {
    const first = {
      ...operationNode(),
      id: 'first',
      type: 'image' as const,
      data: { url: '1.png' },
    }
    const last = { ...operationNode(), id: 'last', type: 'image' as const, data: { url: '2.png' } }
    const design = {
      ...operationNode(),
      id: 'design',
      type: 'image' as const,
      data: { url: 'design.png' },
    }

    expect(
      buildCanvasInputBindingsForRoles([first, last, design], {
        first: 'first_frame',
        last: 'last_frame',
        design: 'reference',
      }),
    ).toEqual([
      expect.objectContaining({ sourceNodeId: 'first', role: 'first_frame' }),
      expect.objectContaining({ sourceNodeId: 'last', role: 'last_frame' }),
      expect.objectContaining({ sourceNodeId: 'design', role: 'reference' }),
    ])
  })

  it('reads screenplay text from the completed 转剧本 operation primary output node', () => {
    const operation = operationNode()
    const output: CanvasNode = {
      ...operation,
      id: 'node-screenplay-output',
      type: 'text',
      taskId: null,
      assetId: 'asset-screenplay',
      title: '转剧本结果',
      x: 500,
      data: {
        text: '场 1：雨夜车站\n林岚走入候车厅。',
        format: 'markdown',
        origin: 'task_output',
        pipelineRole: 'screenplay',
      },
    }
    const snapshot = snapshotWith([operation, output], screenplayTask([output.id]))

    expect(resolveCanvasPipelineTextSource(operation, snapshot)).toEqual({
      sourceNode: output,
      sourceText: '场 1：雨夜车站\n林岚走入候车厅。',
    })
  })

  it('uses asset text but keeps the operation node when the output has no persisted node', () => {
    const operation = operationNode()
    const snapshot = snapshotWith([operation], screenplayTask([]))

    expect(resolveCanvasPipelineTextSource(operation, snapshot)).toEqual({
      sourceNode: operation,
      sourceText: '场 1：雨夜车站\n林岚走入候车厅。',
    })
  })

  it('keeps a single-child group as the downstream lineage source', () => {
    const group: CanvasNode = {
      ...operationNode(),
      id: 'group-screenplay',
      type: 'group',
      taskId: null,
      title: '剧本分组',
      data: {},
    }
    const child: CanvasNode = {
      ...group,
      id: 'node-screenplay-child',
      type: 'text',
      parentNodeId: group.id,
      title: '第一场',
      data: { text: '场 1：雨夜车站' },
    }
    const snapshot = snapshotWith([group, child], screenplayTask([]))

    expect(resolveCanvasPipelineTextSource(group, snapshot)).toEqual({
      sourceNode: group,
      sourceText: '场 1：雨夜车站',
    })
  })

  it('serializes storyboard pipeline input as field-value text instead of a Markdown table', () => {
    const storyboard: CanvasNode = {
      ...operationNode(),
      id: 'storyboard-1',
      type: 'text',
      taskId: null,
      title: '分镜脚本',
      data: {
        pipelineRole: 'shot',
        text: JSON.stringify({
          shots: [
            {
              index: 1,
              title: '烟雾与拒绝',
              sceneName: '狭窄出租房',
              characters: ['苏烬'],
              description: '苏烬面对电脑屏幕缓慢吐出烟雾',
            },
          ],
        }),
      },
    }

    const result = buildPipelineSourceText([storyboard], [])

    expect(result).toContain('名称：烟雾与拒绝')
    expect(result).toContain('角色：苏烬')
    expect(result).toContain('场景：狭窄出租房')
    expect(result).not.toContain('| 镜号 |')
    expect(result).not.toContain('"shots"')
  })
})
