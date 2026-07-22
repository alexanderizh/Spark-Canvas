export class CanvasDirtyTracker {
  private readonly dirtyIds = new Set<string>()
  private readonly revisions = new Map<string, number>()

  get size(): number {
    return this.dirtyIds.size
  }

  has(projectId: string): boolean {
    return this.dirtyIds.has(projectId)
  }

  revision(projectId: string): number {
    return this.revisions.get(projectId) ?? 0
  }

  markDirty(projectId: string): void {
    this.revisions.set(projectId, this.revision(projectId) + 1)
    this.dirtyIds.add(projectId)
  }

  markClean(projectId: string): void {
    this.dirtyIds.delete(projectId)
  }

  markCleanIfUnchanged(projectId: string, savedRevision: number): boolean {
    if (this.revision(projectId) !== savedRevision) return false
    this.dirtyIds.delete(projectId)
    return true
  }

  reset(): void {
    this.dirtyIds.clear()
    this.revisions.clear()
  }
}
