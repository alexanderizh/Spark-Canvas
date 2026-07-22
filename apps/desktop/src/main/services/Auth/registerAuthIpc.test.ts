import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  configureCredentialVaultPersistence: vi.fn(),
  preloadSecrets: vi.fn(),
  bootstrap: vi.fn(async () => ({ isAuthenticated: true, baseUrl: 'https://spark.example' })),
  register: vi.fn(async () => ({
    token: 'register-access',
    refreshToken: 'register-refresh',
    userId: 'register-user',
  })),
  login: vi.fn(async () => ({
    token: 'login-access',
    refreshToken: 'login-refresh',
    userId: 'login-user',
  })),
  forceRefresh: vi.fn(async () => ({
    token: 'renewed-access',
    refreshToken: 'renewed-refresh',
    userId: 'refresh-user',
  })),
  loginBySms: vi.fn(async () => ({
    token: 'sms-access',
    refreshToken: 'sms-refresh',
    userId: 'sms-user',
    isNew: true,
  })),
  wechatPoll: vi.fn(async () => ({
    status: 'success' as const,
    userId: 'wechat-user',
    isNew: false,
  })),
  wechatBindEmail: vi.fn(async () => ({
    token: 'wechat-access',
    refreshToken: 'wechat-refresh',
    userId: 'wechat-user',
    isNew: false,
  })),
  uploadFile: vi.fn(async () => ({ url: 'https://spark.example/uploaded.png' })),
  warn: vi.fn(),
}))

vi.mock('../../ipc/typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mocks.handlers.set(channel, handler)
  },
}))
vi.mock('./AuthService', () => ({
  getAuthService: () => ({
    getCurrentUserId: () => 'spark-user-1',
    bootstrap: mocks.bootstrap,
    register: mocks.register,
    login: mocks.login,
    forceRefresh: mocks.forceRefresh,
    loginBySms: mocks.loginBySms,
    wechatPoll: mocks.wechatPoll,
    wechatBindEmail: mocks.wechatBindEmail,
    uploadFile: mocks.uploadFile,
  }),
}))
vi.mock('../../db.js', () => ({ getDatabase: () => ({}) }))
vi.mock('@spark/storage', () => ({
  ProviderProfileRepository: class {
    listAll() {
      return [{ keystore_ref: 'provider-ref' }]
    }
  },
  ConnectorConnectionRepository: class {
    listAll() {
      return [{ keystore_ref: 'connector-ref' }]
    }
  },
  SettingsRepository: class {},
}))
vi.mock('@spark/shared/keystore', () => ({
  configureCredentialVaultPersistence: mocks.configureCredentialVaultPersistence,
  preloadSecrets: mocks.preloadSecrets,
}))
vi.mock('../CredentialVaultPersistence.js', () => ({
  createCredentialVaultPersistence: () => ({ load: vi.fn(), save: vi.fn() }),
}))
vi.mock('@spark/shared', () => ({
  SparkError: class extends Error {},
  createLogger: () => ({ warn: mocks.warn }),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showMessageBox: vi.fn() },
}))

import { registerAuthIpc } from './registerAuthIpc.js'

describe('auth bootstrap boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
  })

  it('delegates authentication without owning BYOK credential startup', async () => {
    registerAuthIpc()
    const bootstrapHandler = mocks.handlers.get('auth:bootstrap')

    await expect(bootstrapHandler?.()).resolves.toMatchObject({ isAuthenticated: true })
    expect(mocks.configureCredentialVaultPersistence).not.toHaveBeenCalled()
    expect(mocks.preloadSecrets).not.toHaveBeenCalled()
    expect(mocks.bootstrap).toHaveBeenCalledOnce()
  })

  it('uses the Spark Canvas credential namespace in the macOS disclosure', () => {
    const source = readFileSync(join(__dirname, '../CredentialVaultStartup.ts'), 'utf8')

    expect(source).toContain('为什么 Spark Canvas 需要访问钥匙串？')
    expect(source).toContain('“spark-canvas”')
    expect(source).not.toContain('SparkWork')
    expect(source).not.toContain('“spark-agent”')
  })

  it('returns only non-sensitive session state to the renderer', async () => {
    registerAuthIpc()

    const responses = {
      register: await mocks.handlers.get('auth:register')?.({
        account: 'user@example.com',
        password: 'secret',
        code: '123456',
      }),
      login: await mocks.handlers.get('auth:login')?.({
        account: 'user@example.com',
        loginMode: 'password',
        password: 'secret',
      }),
      refresh: await mocks.handlers.get('auth:refresh')?.({}),
      sms: await mocks.handlers.get('auth:login-sms')?.({
        phone: '13800138000',
        smsCode: '123456',
      }),
      wechatPoll: await mocks.handlers.get('auth:wechat-poll')?.({ state: 'wechat-state' }),
      wechatBind: await mocks.handlers.get('auth:wechat-bind-email')?.({
        bindSession: 'bind-session',
        code: '123456',
      }),
    }

    expect(responses).toEqual({
      register: { userId: 'register-user' },
      login: { userId: 'login-user' },
      refresh: { userId: 'refresh-user' },
      sms: { userId: 'sms-user', isNew: true },
      wechatPoll: { status: 'success', userId: 'wechat-user', isNew: false },
      wechatBind: { userId: 'wechat-user', isNew: false },
    })
    expect(JSON.stringify(responses)).not.toMatch(/"(?:token|refreshToken)"/)
  })

  it('authorizes file-path uploads against the invoking sender', async () => {
    const sender = { id: 'canvas-window' }
    const resolveReadableFile = vi.fn(() => '/canonical/project/input.png')
    registerAuthIpc({ resolveReadableFile })

    await mocks.handlers.get('auth:upload-file')?.(
      { filePath: '/renderer/input.png', fileName: 'input.png' },
      { sender },
    )

    expect(resolveReadableFile).toHaveBeenCalledWith(sender, '/renderer/input.png')
    expect(mocks.uploadFile).toHaveBeenCalledWith({
      filePath: '/canonical/project/input.png',
      fileName: 'input.png',
    })
  })
})
