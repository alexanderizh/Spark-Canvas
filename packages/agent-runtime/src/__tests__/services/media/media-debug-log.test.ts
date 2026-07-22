import { describe, expect, it } from 'vitest'
import { compactForLog } from '../../../services/media/media-debug-log.js'

describe('compactForLog', () => {
  it('summarizes data URLs and bare base64 without retaining their full payloads', () => {
    const payload = 'aGVsbG8td29ybGQ='.repeat(20)
    const result = compactForLog({
      image: `data:image/png;base64,${payload}`,
      b64_json: payload,
    }) as Record<string, string>

    expect(result.image).toContain('[base64 mime=image/png')
    expect(result.b64_json).toContain('[base64')
    expect(result.image).not.toContain('preview=')
    expect(result.b64_json).not.toContain('preview=')
    expect(result.image).not.toContain(payload.slice(0, 8))
    expect(result.image).not.toContain(payload.slice(-8))
    expect(result.b64_json).not.toContain(payload.slice(0, 8))
    expect(result.b64_json).not.toContain(payload.slice(-8))
    expect(result.image).not.toContain(payload)
    expect(result.b64_json).not.toContain(payload)
  })

  it('fully masks authorization and API key values', () => {
    const result = compactForLog({
      Authorization: 'Bearer secret-token',
      apiKey: 'sk-secret-value',
      nested: { access_token: 'access-secret' },
    }) as Record<string, unknown>

    expect(result.Authorization).toBe('[REDACTED]')
    expect(result.apiKey).toBe('[REDACTED]')
    expect((result.nested as Record<string, unknown>).access_token).toBe('[REDACTED]')
  })

  it('redacts signed URL queries and base64 source data while keeping useful URL metadata', () => {
    const signedUrl =
      'https://uploads.spark.example/owners/user-1/reference.png?X-Amz-Credential=credential&X-Amz-Signature=secret-signature#private-fragment'
    const base64 = 'c2Vuc2l0aXZlLWltYWdlLWJ5dGVz'

    const result = compactForLog({
      input_image: { image_url: signedUrl },
      source: { type: 'base64', media_type: 'image/png', data: base64 },
    }) as {
      input_image: { image_url: string }
      source: { data: string }
    }

    expect(result.input_image.image_url).toBe(
      'https://uploads.spark.example/owners/user-1/reference.png?[REDACTED]',
    )
    expect(result.source.data).toContain('[base64')
    expect(result.source.data).toContain('sha256=')
    expect(JSON.stringify(result)).not.toContain('secret-signature')
    expect(JSON.stringify(result)).not.toContain('private-fragment')
    expect(JSON.stringify(result)).not.toContain(base64)
  })

  it('removes HTTP URL userinfo with or without signed query parameters', () => {
    const result = compactForLog({
      plain: 'https://private-user:private-password@uploads.spark.example/reference.png',
      signed:
        'https://signed-user:signed-password@uploads.spark.example/reference.png?X-Amz-Signature=secret-signature#private-fragment',
    }) as { plain: string; signed: string }

    expect(result.plain).toBe('https://uploads.spark.example/reference.png')
    expect(result.signed).toBe('https://uploads.spark.example/reference.png?[REDACTED]')
    expect(JSON.stringify(result)).not.toContain('private-user')
    expect(JSON.stringify(result)).not.toContain('private-password')
    expect(JSON.stringify(result)).not.toContain('signed-user')
    expect(JSON.stringify(result)).not.toContain('signed-password')
    expect(JSON.stringify(result)).not.toContain('secret-signature')
    expect(JSON.stringify(result)).not.toContain('private-fragment')
  })

  it('truncates long prompt text while retaining its character count', () => {
    const result = compactForLog({ prompt: '场'.repeat(5_000) }) as Record<string, string>

    expect(result.prompt).toContain('[truncated chars=5000]')
    expect(result.prompt?.length).toBeLessThan(1_000)
  })
})
