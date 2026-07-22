import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  buildCanvasMediaProviderPrompt,
  buildCanvasRuntimeRequest,
  buildCanvasSystemPrompt,
  resolveCanvasAgentTurnResult,
} from './canvas-prompt-runtime'

describe('canvas prompt runtime adapter', () => {
  it('keeps compiled user text separate from capability and skill instructions', () => {
    const system = buildCanvasSystemPrompt({
      capabilityPrompt: '只输出可执行分镜',
      presetPrompt: '镜头时长必须统一',
      agentPrompt: '你是导演',
      skillPrompts: ['使用电影术语'],
      negativePrompt: '不要解释过程',
    })
    const request = buildCanvasRuntimeRequest({
      prompt: '[角色 ref-1: 小满]\n雨夜',
      compiledUserText: '[角色 ref-1: 小满]\n雨夜',
      systemPrompt: system,
      inputFiles: [{ type: 'image', role: 'reference', url: 'https://cdn/ref.png' }],
      relationManifest: [{ blockId: 'r1', sourceNodeId: 'n1', relation: 'character', order: 0 }],
    })

    expect(request.prompt).toBe('[角色 ref-1: 小满]\n雨夜')
    expect(request.prompt).not.toContain('只输出可执行分镜')
    expect(request.system).toContain('你是导演')
    expect(request.images).toEqual([{ url: 'https://cdn/ref.png' }])
    expect(request.relationManifest).toEqual([
      { blockId: 'r1', sourceNodeId: 'n1', relation: 'character', order: 0 },
    ])
  })

  it('adds hidden system instructions to media provider text without changing the authored prompt', () => {
    expect(
      buildCanvasMediaProviderPrompt({ systemPrompt: '能力约束', userPrompt: '用户要求' }),
    ).toBe('能力约束\n\n用户要求')
    expect(buildCanvasMediaProviderPrompt({ systemPrompt: '', userPrompt: '用户要求' })).toBe(
      '用户要求',
    )
  })

  it('waits for terminal agent status before cleaning up a final text turn', () => {
    const base = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      timestamp: '2026-07-22T00:00:00.000Z',
      seq: 1,
    }
    const finalMessage = {
      ...base,
      id: 'message-1',
      type: 'assistant_message',
      mode: 'complete',
      content: '{"shots":[]}',
      isFinal: true,
    } as AgentEvent
    expect(resolveCanvasAgentTurnResult([finalMessage])).toEqual({
      terminal: false,
      text: '{"shots":[]}',
    })

    expect(
      resolveCanvasAgentTurnResult([
        finalMessage,
        { ...base, id: 'status-1', type: 'agent_status', status: 'completed' } as AgentEvent,
      ]),
    ).toEqual({ terminal: true, text: '{"shots":[]}' })
  })
})
