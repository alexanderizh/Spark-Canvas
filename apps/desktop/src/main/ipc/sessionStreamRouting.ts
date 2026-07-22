export interface SessionStreamRoutingDependencies {
  getSessionSurface(sessionId: string): 'canvas' | null | undefined
  sendToCanvasSession(sessionId: string, channel: string, payload: unknown): boolean
  broadcast(channel: string, payload: unknown): void
}

export type SessionStreamRoute =
  | 'canvas-delivered'
  | 'canvas-detached'
  | 'broadcast'
  | 'session-missing'

export function routeSessionStreamEvent(
  dependencies: SessionStreamRoutingDependencies,
  channel: string,
  sessionId: string,
  payload: unknown,
): SessionStreamRoute {
  const surface = dependencies.getSessionSurface(sessionId)
  if (surface === undefined) return 'session-missing'
  if (surface === 'canvas') {
    return dependencies.sendToCanvasSession(sessionId, channel, payload)
      ? 'canvas-delivered'
      : 'canvas-detached'
  }

  dependencies.broadcast(channel, payload)
  return 'broadcast'
}
