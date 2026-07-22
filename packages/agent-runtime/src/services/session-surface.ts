import type { SessionSurface } from '@spark/protocol'

export function getSessionSurface(metadataJson: string | null | undefined): SessionSurface | null {
  if (metadataJson == null || metadataJson === '') return null
  try {
    const metadata = JSON.parse(metadataJson) as { surface?: unknown }
    return metadata.surface === 'canvas' ? 'canvas' : null
  } catch {
    return null
  }
}
