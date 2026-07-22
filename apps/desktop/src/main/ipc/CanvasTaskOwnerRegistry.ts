import { SparkError } from '@spark/shared'

interface CanvasTaskOwner {
  sender: unknown
  projectId: string
}

export class CanvasTaskOwnerRegistry {
  private readonly owners = new Map<string, CanvasTaskOwner>()

  claim(runtimeTaskId: string, sender: unknown, projectId: string): void {
    this.owners.set(runtimeTaskId, { sender, projectId })
  }

  requireOwner(runtimeTaskId: string, sender: unknown, activeProjectId: string | null): void {
    const owner = this.owners.get(runtimeTaskId)
    if (owner == null || owner.sender !== sender || owner.projectId !== activeProjectId) {
      throw new SparkError('PERMISSION_DENIED', '当前窗口无权取消该媒体任务。')
    }
  }

  release(runtimeTaskId: string): void {
    this.owners.delete(runtimeTaskId)
  }
}
