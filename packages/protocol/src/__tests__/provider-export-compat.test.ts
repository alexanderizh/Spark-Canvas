import { describe, expect, it } from 'vitest'
import { ProviderExportPayloadSchema } from '../provider-export.js'

const profile = {
  id: 'legacy-provider',
  name: 'Legacy Provider',
  provider: 'openai-compatible',
  apiEndpoint: 'https://example.com/v1',
  defaultModel: 'legacy-model',
  modelIds: ['legacy-model'],
  supportsMillionContext: false,
  isDefault: false,
}

describe('provider export identity compatibility', () => {
  it.each(['spark-agent', 'spark-canvas'])(
    'accepts %s provider backups for import',
    (exportedBy) => {
      const parsed = ProviderExportPayloadSchema.parse({
        version: 2,
        exportedAt: '2026-07-20T00:00:00.000Z',
        exportedBy,
        profiles: [profile],
      })

      expect(parsed.exportedBy).toBe(exportedBy)
    },
  )
})
