import { describe, expect, it, vi } from 'vitest'
import type { AgentItem } from '@spark/storage'
import { CANVAS_ASSISTANT_AGENT_ID } from '@spark/shared'
import { resolveCanvasTextTaskAgent } from './canvasTextAgentPolicy.js'

function makeAgent(overrides: Partial<AgentItem> = {}): AgentItem {
  return {
    id: CANVAS_ASSISTANT_AGENT_ID,
    name: '画布助手',
    description: '',
    builtIn: true,
    enabled: true,
    isDefault: false,
    providerProfileId: null,
    modelId: null,
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-bypass',
    reasoningEffort: 'high',
    prompt: 'Canvas assistant prompt',
    ruleIds: [],
    skillIds: [],
    disabledSkillIds: [],
    mcpServerIds: [],
    hookConfig: {},
    workflowId: null,
    metadata: { role: 'canvas-assistant' },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('Canvas text task Agent policy', () => {
  it('uses the built-in Canvas Assistant when the renderer omits agentId', () => {
    const assistant = makeAgent()
    const get = vi.fn((id: string) => (id === CANVAS_ASSISTANT_AGENT_ID ? assistant : null))

    expect(resolveCanvasTextTaskAgent({ get }, undefined)).toBe(assistant)
    expect(get).toHaveBeenCalledWith(CANVAS_ASSISTANT_AGENT_ID)
  })

  it('rejects platform or custom agents on the Canvas text surface', () => {
    const get = vi.fn()

    expect(() => resolveCanvasTextTaskAgent({ get }, 'platform-manager-agent')).toThrow(
      'Canvas text tasks only support the built-in Canvas Assistant',
    )
    expect(get).not.toHaveBeenCalled()
  })

  it('fails closed when the Canvas Assistant is missing, disabled, or not built in', () => {
    for (const assistant of [null, makeAgent({ enabled: false }), makeAgent({ builtIn: false })]) {
      expect(() =>
        resolveCanvasTextTaskAgent({ get: () => assistant }, CANVAS_ASSISTANT_AGENT_ID),
      ).toThrow('Built-in Canvas Assistant is unavailable')
    }
  })
})
