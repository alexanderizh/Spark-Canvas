import type {
  AuthLoginResponse,
  AuthLoginSmsResponse,
  AuthRefreshResponse,
  AuthRegisterResponse,
  AuthWechatBindEmailResponse,
  AuthWechatPollResponse,
  IpcStreamPayload,
} from '../ipc/index.js'
import { describe, expect, it } from 'vitest'

const tokenRefreshedPayload = {
  userId: 'spark-user-1',
} satisfies IpcStreamPayload<'stream:auth:token-refreshed'>

const rendererSessionResponses = {
  login: { userId: 'spark-user-1' } satisfies AuthLoginResponse,
  register: { userId: 'spark-user-1' } satisfies AuthRegisterResponse,
  refresh: { userId: 'spark-user-1' } satisfies AuthRefreshResponse,
  sms: { userId: 'spark-user-1', isNew: false } satisfies AuthLoginSmsResponse,
  wechatBind: {
    userId: 'spark-user-1',
    isNew: false,
  } satisfies AuthWechatBindEmailResponse,
  wechatPoll: {
    status: 'success',
    userId: 'spark-user-1',
    isNew: false,
  } satisfies AuthWechatPollResponse,
}

describe('auth stream contract', () => {
  it('exposes only non-sensitive refresh state to the renderer', () => {
    expect(tokenRefreshedPayload).toEqual({ userId: 'spark-user-1' })
    expect(tokenRefreshedPayload).not.toHaveProperty('token')
    expect(tokenRefreshedPayload).not.toHaveProperty('refreshToken')
  })

  it('keeps credentials out of every renderer-facing session response', () => {
    expect(JSON.stringify(rendererSessionResponses)).not.toContain('token')
    expect(JSON.stringify(rendererSessionResponses)).not.toContain('refreshToken')
  })
})
