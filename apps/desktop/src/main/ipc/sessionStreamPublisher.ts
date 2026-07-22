import { SessionRepository } from '@spark/storage'

import { getCanvasHostBridge } from '../canvas-host-bridge.js'
import { getDatabase } from '../db.js'
import { toCanvasAgentSessionRecord } from './canvasAgentSession.js'
import { pushStreamEvent } from './typed-ipc.js'
import { routeSessionStreamEvent } from './sessionStreamRouting.js'

export function pushSessionStreamEvent(
  channel: string,
  sessionId: string,
  payload: unknown,
): void {
  routeSessionStreamEvent(
    {
      getSessionSurface: (id) => {
        const row = new SessionRepository(getDatabase()).get(id)
        if (row == null) return undefined
        return toCanvasAgentSessionRecord(row)?.surface ?? null
      },
      sendToCanvasSession: (id, streamChannel, streamPayload) =>
        getCanvasHostBridge().sendToAttachedSession(id, streamChannel, streamPayload),
      broadcast: pushStreamEvent,
    },
    channel,
    sessionId,
    payload,
  )
}
