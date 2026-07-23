// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ManagedAgent } from '@spark/protocol'
import {
  CANVAS_AGENT_SKILL_IDS,
  CANVAS_AGENT_DRAFTS_KEY,
  CANVAS_AGENT_PREFS_KEY,
  LEGACY_CANVAS_AGENT_DRAFTS_KEY,
  LEGACY_CANVAS_AGENT_PREFS_KEY,
  createCanvasSessionRequest,
  filterCanvasAgentSkills,
  filterCanvasAssistantAgents,
  pickCanvasAssistantAgent,
  readCanvasAgentStorageItem,
} from './canvasAgentPolicy'

function makeAgent(id: string, role: string | undefined, builtIn = false): ManagedAgent {
  return {
    id,
    name: id,
    description: '',
    builtIn,
    enabled: true,
    isDefault: false,
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-bypass',
    reasoningEffort: 'high',
    prompt: '',
    ruleIds: [],
    skillIds: [],
    disabledSkillIds: [],
    mcpServerIds: [],
    hookConfig: {},
    metadata: role == null ? {} : { role },
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
}

describe('Canvas Agent product policy', () => {
  it('marks renderer-created sessions as canvas sessions', () => {
    expect(
      createCanvasSessionRequest({
        providerProfileId: 'provider-1',
        agentId: 'canvas-assistant-agent',
      }),
    ).toMatchObject({
      providerProfileId: 'provider-1',
      agentId: 'canvas-assistant-agent',
      surface: 'canvas',
    })
  })

  it('shows only the built-in canvas assistant and rejects role impersonation', () => {
    const canvas = makeAgent('canvas-assistant-agent', 'canvas-assistant', true)
    const impersonator = makeAgent('custom-canvas', 'canvas-assistant')
    const platform = makeAgent('platform-manager-agent', 'platform-manager', true)
    const general = makeAgent('general-agent', 'general')

    const filtered = filterCanvasAssistantAgents([platform, general, impersonator, canvas])

    expect(filtered.map((agent) => agent.id)).toEqual(['canvas-assistant-agent'])
    expect(pickCanvasAssistantAgent(filtered, 'platform-manager-agent')).toBe(canvas)
    expect(pickCanvasAssistantAgent([platform, impersonator], 'custom-canvas')).toBeNull()
  })

  it('uses only the built-in canvas assistant as a compatibility fallback', () => {
    const legacyCanvas = makeAgent('canvas-assistant-agent', undefined, true)
    const platform = makeAgent('platform-manager-agent', 'platform-manager', true)

    expect(filterCanvasAssistantAgents([platform, legacyCanvas])).toEqual([legacyCanvas])
  })

  it('keeps Canvas task configuration entrypoints model-only', () => {
    const entrypoints = [
      'CanvasOperationPanel.tsx',
      'CanvasOperationPresetModal.tsx',
      'CanvasInlineAiComposer.tsx',
    ].map((file) => readFileSync(join(__dirname, file), 'utf8'))

    for (const source of entrypoints) {
      expect(source).not.toContain('AgentPickerInline')
      expect(source).not.toContain("'agent:list'")
      expect(source).not.toContain("'skill:list'")
    }
  })

  it('keeps Canvas renderers off generic Agent, Session, and Skill mutation channels', () => {
    const sources = [
      'CanvasAgentModal.tsx',
      'CanvasInlineAiComposer.tsx',
      'CanvasOperationPanel.tsx',
      'CanvasOperationPresetModal.tsx',
    ].map((file) => readFileSync(join(__dirname, file), 'utf8'))

    for (const source of sources) {
      expect(source).not.toContain("'agent:list'")
      expect(source).not.toContain("'skill:list'")
      expect(source).not.toContain("'skill-config:update'")
      expect(source).not.toContain("'session:create'")
      expect(source).not.toContain("'session:list'")
      expect(source).not.toContain("'session:update'")
      expect(source).not.toContain("'session:submit-turn'")
    }

    expect(sources[0]).toContain("'canvas:agent:session:get-history'")
    expect(sources[0]).toContain("'canvas:agent:session:cancel'")
    expect(sources[0]).toContain("'canvas:agent:session:answer-question'")
    expect(sources[0]).not.toContain("fallbackLabel = '平台管理'")
  })

  it('exposes only the frozen Canvas Agent skill ids', () => {
    const skills = [
      { id: 'builtin:find-skills' },
      { id: 'builtin:video-workflow' },
      { id: 'builtin:platform-manager' },
      { id: 'builtin:canvas-studio' },
      { id: 'builtin:multimedia-use' },
    ]

    expect(filterCanvasAgentSkills(skills).map((skill) => skill.id)).toEqual([
      'builtin:video-workflow',
      'builtin:canvas-studio',
      'builtin:multimedia-use',
    ])
    expect(CANVAS_AGENT_SKILL_IDS).toEqual([
      'builtin:canvas-studio',
      'builtin:multimedia-use',
      'builtin:video-workflow',
    ])
  })

  it('migrates old Spark Agent preference and draft keys on first read', () => {
    window.localStorage.setItem(LEGACY_CANVAS_AGENT_PREFS_KEY, '{"draftAgentId":"old"}')
    window.localStorage.setItem(LEGACY_CANVAS_AGENT_DRAFTS_KEY, '{"project-1":"draft"}')

    expect(
      readCanvasAgentStorageItem(
        window.localStorage,
        CANVAS_AGENT_PREFS_KEY,
        LEGACY_CANVAS_AGENT_PREFS_KEY,
      ),
    ).toBe('{"draftAgentId":"old"}')
    expect(
      readCanvasAgentStorageItem(
        window.localStorage,
        CANVAS_AGENT_DRAFTS_KEY,
        LEGACY_CANVAS_AGENT_DRAFTS_KEY,
      ),
    ).toBe('{"project-1":"draft"}')
    expect(window.localStorage.getItem(CANVAS_AGENT_PREFS_KEY)).toBe('{"draftAgentId":"old"}')
    expect(window.localStorage.getItem(CANVAS_AGENT_DRAFTS_KEY)).toBe('{"project-1":"draft"}')
    expect(window.localStorage.getItem(LEGACY_CANVAS_AGENT_PREFS_KEY)).toBeNull()
    expect(window.localStorage.getItem(LEGACY_CANVAS_AGENT_DRAFTS_KEY)).toBeNull()
  })
})
