import { describe, expect, it } from 'vitest'
import {
  CANVAS_INVOKE_CHANNELS,
  CANVAS_STREAM_CHANNELS,
  isCanvasInvokeChannelAllowed,
  isCanvasStreamChannelAllowed,
} from './canvasIpcPolicy.js'

describe('Spark Canvas IPC policy', () => {
  it('allows the Canvas workbench and shared Spark infrastructure', () => {
    expect(isCanvasInvokeChannelAllowed('canvas:snapshot:save')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('canvas:agent:open-workspace')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('canvas:agent:session:submit-turn')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('provider:list')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('provider:files:upload')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('file:save-canvas-annotation')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('auth:upload-file')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('platform-model:pay')).toBe(true)
    expect(isCanvasInvokeChannelAllowed('video:process')).toBe(true)
    expect(isCanvasStreamChannelAllowed('stream:canvas:media-task')).toBe(true)
    expect(isCanvasStreamChannelAllowed('stream:auth:state-changed')).toBe(true)
  })

  it('keeps the reviewed channel inventory explicit and duplicate-free', () => {
    expect(CANVAS_INVOKE_CHANNELS).toHaveLength(119)
    expect(new Set(CANVAS_INVOKE_CHANNELS).size).toBe(119)
    expect(CANVAS_STREAM_CHANNELS).toHaveLength(13)
    expect(new Set(CANVAS_STREAM_CHANNELS).size).toBe(13)
  })

  it.each([
    'board:list',
    'team:list-defs',
    'workflow:list',
    'remote:list',
    'scheduled-task:list',
    'task-execution:list',
    'terminal:list',
    'skill-registry:list',
    'playwright:status',
    'github-connector:get',
    'history-import:scan',
    'memory:list',
    'rules:list',
    'mcp:list',
    'agent:create',
    'agent:list',
    'session:answer-question',
    'session:cancel',
    'session:create',
    'session:get-history',
    'session:list',
    'session:submit-turn',
    'session:update',
    'skill-config:update',
    'skill:list',
    'workspace:open',
  ])('rejects legacy platform invoke channel %s', (channel) => {
    expect(isCanvasInvokeChannelAllowed(channel)).toBe(false)
  })

  it.each([
    'stream:session:created',
    'stream:remote:changed',
    'stream:history-import:progress',
    'stream:playwright:status',
    'stream:scheduled-task:execution',
    'stream:terminal:event',
    'stream:tray:new-session',
  ])('rejects legacy platform stream channel %s', (channel) => {
    expect(isCanvasStreamChannelAllowed(channel)).toBe(false)
  })

  it('fails closed for unknown channels', () => {
    expect(isCanvasInvokeChannelAllowed('future-platform:execute')).toBe(false)
    expect(isCanvasStreamChannelAllowed('stream:future-platform:event')).toBe(false)
  })
})
