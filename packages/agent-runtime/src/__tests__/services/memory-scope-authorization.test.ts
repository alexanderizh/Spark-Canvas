import { describe, expect, it } from 'vitest'

import {
  filterMemoryEntriesForScopes,
  isMemoryEntryAllowedForScopes,
} from '../../services/memory-scope-authorization.js'

const scopes = [
  { scope: 'user' as const, scopeRef: null },
  { scope: 'project' as const, scopeRef: 'workspace-1' },
  { scope: 'agent' as const, scopeRef: 'canvas-assistant-agent' },
]

describe('memory scope authorization', () => {
  it('allows only entries inside the session-derived scopes', () => {
    expect(
      isMemoryEntryAllowedForScopes({ scope: 'project', scope_ref: 'workspace-1' }, scopes),
    ).toBe(true)
    expect(
      isMemoryEntryAllowedForScopes({ scope: 'project', scope_ref: 'workspace-2' }, scopes),
    ).toBe(false)
    expect(
      isMemoryEntryAllowedForScopes(
        { scope: 'agent', scope_ref: 'platform-manager-agent' },
        scopes,
      ),
    ).toBe(false)
  })

  it('removes related memories from other projects and agents', () => {
    const entries = [
      { id: 'user', scope: 'user' as const, scope_ref: null },
      { id: 'project-ok', scope: 'project' as const, scope_ref: 'workspace-1' },
      { id: 'project-leak', scope: 'project' as const, scope_ref: 'workspace-2' },
      {
        id: 'agent-leak',
        scope: 'agent' as const,
        scope_ref: 'platform-manager-agent',
      },
    ]

    expect(filterMemoryEntriesForScopes(entries, scopes).map((entry) => entry.id)).toEqual([
      'user',
      'project-ok',
    ])
  })
})
