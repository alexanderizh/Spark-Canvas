export interface MemoryScopeAuthorization {
  scope: 'user' | 'project' | 'agent'
  scopeRef: string | null
}

export interface ScopedMemoryEntry {
  scope: 'user' | 'project' | 'agent'
  scope_ref: string | null
}

export function isMemoryEntryAllowedForScopes(
  entry: ScopedMemoryEntry,
  scopes: ReadonlyArray<MemoryScopeAuthorization>,
): boolean {
  return scopes.some(
    (scope) => scope.scope === entry.scope && scope.scopeRef === entry.scope_ref,
  )
}

export function filterMemoryEntriesForScopes<T extends ScopedMemoryEntry>(
  entries: ReadonlyArray<T>,
  scopes: ReadonlyArray<MemoryScopeAuthorization>,
): T[] {
  return entries.filter((entry) => isMemoryEntryAllowedForScopes(entry, scopes))
}
