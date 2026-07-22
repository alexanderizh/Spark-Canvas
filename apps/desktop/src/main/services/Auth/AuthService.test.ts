import type { AuthMeResponse, AuthSession } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  initialSession: {} as Partial<AuthSession>,
  nextGet: undefined as unknown,
  nextPost: undefined as unknown,
  order: [] as string[],
  posts: [] as Array<{ path: string; body: unknown }>,
  streams: [] as Array<{ channel: string; payload: unknown }>,
  allowedUploadRoots: [] as string[],
  readFilePaths: [] as string[],
  fileUploads: [] as Array<{ buffer: Buffer; fileName: string; mimeType?: string }>,
  avatarUploads: [] as Array<{ buffer: Buffer; fileName: string; mimeType?: string }>,
  clientOptions: undefined as
    | {
        onSessionExpired: () => void
        onTokenRefreshed: (session: AuthSession) => void
      }
    | undefined,
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    readFile: async (filePath: Parameters<typeof actual.readFile>[0]) => {
      mocks.readFilePaths.push(String(filePath))
      return actual.readFile(filePath)
    },
  }
})

vi.mock('./TokenStore', () => ({
  TokenStore: class MockTokenStore {
    private session: Partial<AuthSession> = { ...mocks.initialSession }

    async load(): Promise<Partial<AuthSession>> {
      mocks.order.push('load')
      return { ...this.session }
    }

    async save(session: AuthSession): Promise<void> {
      mocks.order.push(`save:${session.userId}`)
      this.session = { ...session }
    }

    async clear(): Promise<void> {
      mocks.order.push('clear')
      this.session = {}
    }

    get(): Partial<AuthSession> {
      return { ...this.session }
    }

    isAuthenticated(): boolean {
      return Boolean(this.session.token && this.session.refreshToken && this.session.userId)
    }

    isPersistent(): boolean {
      return true
    }

    getLastError(): string | null {
      return null
    }
  },
}))

vi.mock('./EduServerClient', () => ({
  EduServerClient: class MockEduServerClient {
    constructor(options: {
      onSessionExpired: () => void
      onTokenRefreshed: (session: AuthSession) => void
    }) {
      mocks.clientOptions = options
    }

    getBaseUrl(): string {
      return 'https://default.example'
    }

    async get<T>(): Promise<T> {
      return mocks.nextGet as T
    }

    async post<T>(path: string, body: unknown): Promise<T> {
      mocks.posts.push({ path, body })
      return mocks.nextPost as T
    }

    async uploadFile(input: { buffer: Buffer; fileName: string; mimeType?: string }) {
      mocks.fileUploads.push(input)
      return {
        aiUrl: 'https://uploads.example/ai-file',
        fileKey: 'file-key',
        fileName: input.fileName,
        staticUrl: 'https://uploads.example/static-file',
      }
    }

    async uploadAvatar(input: { buffer: Buffer; fileName: string; mimeType?: string }) {
      mocks.avatarUploads.push(input)
      return { avatarUrl: 'https://uploads.example/avatar' }
    }
  },
}))

vi.mock('../SafeFileProtocol.js', async () => {
  const { isCanonicalPathSameOrChild } = await import('../FilePathBoundary.js')
  return {
    isSafeFilePathAllowed: (filePath: string) =>
      mocks.allowedUploadRoots.some((root) => isCanonicalPathSameOrChild(filePath, root)),
  }
})

vi.mock('../../windows/index.js', () => ({
  sendToMainWindow: (channel: string, payload: unknown) => {
    mocks.streams.push({ channel, payload })
  },
}))

import { AuthService } from './AuthService'

function createAuth(): AuthService {
  return new AuthService({
    defaultBaseUrl: 'https://default.example/',
    keytarService: 'SparkAgent.CloudAuth.Test',
  })
}

function session(userId: string): AuthSession {
  return {
    token: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    userId,
  }
}

describe('AuthService base URL configuration', () => {
  beforeEach(() => {
    mocks.initialSession = {}
    mocks.nextGet = undefined
    mocks.nextPost = undefined
    mocks.order.length = 0
    mocks.posts.length = 0
    mocks.streams.length = 0
    mocks.clientOptions = undefined
  })

  it('rejects runtime cloud auth base URL changes', () => {
    const auth = createAuth()

    expect(() => auth.setBaseUrl('https://cloud.example/')).toThrow('暂不支持修改')
  })
})

describe('AuthService account lifecycle hooks', () => {
  beforeEach(() => {
    mocks.initialSession = {}
    mocks.nextGet = undefined
    mocks.nextPost = undefined
    mocks.order.length = 0
    mocks.posts.length = 0
    mocks.streams.length = 0
    mocks.clientOptions = undefined
  })

  it('persists a successful login before notifying login hooks', async () => {
    const auth = createAuth()
    const loginHook = vi.fn(async (userId: string) => {
      mocks.order.push(`login-hook:${userId}`)
    })
    auth.addLoginHook(loginHook)
    mocks.nextPost = session('user-1')

    await auth.login({
      account: 'user@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    expect(loginHook).toHaveBeenCalledOnce()
    expect(loginHook).toHaveBeenCalledWith('user-1')
    expect(mocks.order).toEqual(['save:user-1', 'login-hook:user-1'])
    expect(mocks.streams).toContainEqual({
      channel: 'stream:auth:state-changed',
      payload: { isAuthenticated: true, userId: 'user-1' },
    })
  })

  it('cleans the previous account before persisting a different account', async () => {
    mocks.initialSession = session('user-old')
    const auth = createAuth()
    const logoutHook = vi.fn(async (userId: string | null) => {
      mocks.order.push(`logout-hook:${userId}`)
    })
    const loginHook = vi.fn(async (userId: string) => {
      mocks.order.push(`login-hook:${userId}`)
    })
    auth.addLogoutHook(logoutHook)
    auth.addLoginHook(loginHook)
    mocks.nextPost = session('user-new')

    await auth.login({
      account: 'new@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    expect(logoutHook).toHaveBeenCalledOnce()
    expect(logoutHook).toHaveBeenCalledWith('user-old')
    expect(loginHook).toHaveBeenCalledWith('user-new')
    expect(mocks.order).toEqual(['logout-hook:user-old', 'save:user-new', 'login-hook:user-new'])
  })

  it('does not run account cleanup when the same account signs in again', async () => {
    mocks.initialSession = session('user-1')
    const auth = createAuth()
    const logoutHook = vi.fn(async () => undefined)
    auth.addLogoutHook(logoutHook)
    mocks.nextPost = session('user-1')

    await auth.login({
      account: 'user@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    expect(logoutHook).not.toHaveBeenCalled()
    expect(mocks.order).toEqual(['save:user-1'])
  })

  it('notifies login hooks after restoring and validating a persisted session', async () => {
    mocks.initialSession = session('user-restored')
    mocks.nextGet = { id: 'user-restored' } as unknown as AuthMeResponse
    const auth = createAuth()
    const loginHook = vi.fn(async (userId: string) => {
      mocks.order.push(`login-hook:${userId}`)
    })
    auth.addLoginHook(loginHook)

    await auth.start()
    const result = await auth.bootstrap()

    expect(result).toMatchObject({
      isAuthenticated: true,
      user: { id: 'user-restored' },
    })
    expect(loginHook).toHaveBeenCalledOnce()
    expect(loginHook).toHaveBeenCalledWith('user-restored')
    expect(mocks.order).toEqual(['load', 'login-hook:user-restored'])
    expect(mocks.streams).toContainEqual({
      channel: 'stream:auth:state-changed',
      payload: { isAuthenticated: true, userId: 'user-restored' },
    })
  })

  it('removes hooks through the returned unsubscribe callback', async () => {
    const auth = createAuth()
    const loginHook = vi.fn(async () => undefined)
    const unsubscribe = auth.addLoginHook(loginHook)
    unsubscribe()
    mocks.nextPost = session('user-1')

    await auth.login({ account: 'user@example.com', loginMode: 'code' })

    expect(loginHook).not.toHaveBeenCalled()
  })

  it('persists a successful WeChat poll without returning credentials', async () => {
    mocks.nextGet = {
      status: 'success',
      token: 'wechat-access',
      refreshToken: 'wechat-refresh',
      userId: 'wechat-user',
      isNew: true,
    }
    const auth = createAuth()

    const result = await auth.wechatPoll('wechat-state')

    expect(result).toEqual({
      status: 'success',
      userId: 'wechat-user',
      isNew: true,
    })
    expect(mocks.order).toContain('save:wechat-user')
    expect(JSON.stringify(result)).not.toContain('wechat-access')
    expect(JSON.stringify(result)).not.toContain('wechat-refresh')
  })

  it('never broadcasts refreshed credentials to the renderer', () => {
    createAuth()

    mocks.clientOptions?.onTokenRefreshed(session('user-1'))

    expect(mocks.streams).toContainEqual({
      channel: 'stream:auth:token-refreshed',
      payload: { userId: 'user-1' },
    })
    expect(JSON.stringify(mocks.streams)).not.toContain('access-user-1')
    expect(JSON.stringify(mocks.streams)).not.toContain('refresh-user-1')
  })

  it('finishes expired-session cleanup before saving a newly logged-in account', async () => {
    mocks.initialSession = session('user-old')
    const auth = createAuth()
    let releaseCleanup!: () => void
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    auth.addLogoutHook(async () => {
      mocks.order.push('expired-cleanup-start')
      await cleanupGate
      mocks.order.push('expired-cleanup-finish')
    })
    mocks.clientOptions!.onSessionExpired()
    mocks.nextPost = session('user-new')
    const login = auth.login({
      account: 'new@example.com',
      loginMode: 'password',
      password: 'secret',
    })

    await Promise.resolve()
    expect(mocks.order).toEqual(['expired-cleanup-start'])
    releaseCleanup()
    await login
    expect(mocks.order).toEqual([
      'expired-cleanup-start',
      'expired-cleanup-finish',
      'clear',
      'save:user-new',
    ])
  })
})

describe('AuthService SMS verification contract', () => {
  beforeEach(() => {
    mocks.initialSession = {}
    mocks.nextGet = undefined
    mocks.nextPost = { expire_in: 300 }
    mocks.order.length = 0
    mocks.posts.length = 0
    mocks.streams.length = 0
    mocks.clientOptions = undefined
  })

  it('always sends SMS codes with the login purpose used by login-sms', async () => {
    const auth = createAuth()

    await auth.sendSmsCode({
      phone: '13800138000',
      captchaId: 'captcha-id',
      captchaText: 'abcd',
    })

    expect(mocks.posts).toContainEqual({
      path: '/auth/send-sms',
      body: {
        phone: '13800138000',
        type: 'login',
        captchaId: 'captcha-id',
        captchaText: 'abcd',
      },
    })
  })
})

describe('AuthService upload boundaries', () => {
  let allowedRoot: string

  beforeEach(async () => {
    allowedRoot = await mkdtemp(join(tmpdir(), 'spark-canvas-auth-upload-'))
    mocks.allowedUploadRoots = [allowedRoot]
    mocks.fileUploads.length = 0
    mocks.avatarUploads.length = 0
    mocks.readFilePaths.length = 0
  })

  afterEach(async () => {
    await rm(allowedRoot, { recursive: true, force: true })
  })

  it('rejects file paths outside the safe-file allowlist', async () => {
    const auth = createAuth()

    await expect(
      auth.uploadFile({
        filePath: join(process.cwd(), 'package.json'),
        mimeType: 'video/mp4',
      }),
    ).rejects.toMatchObject({
      name: 'SparkError',
      code: 'VALIDATION_FAILED',
    })
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it('rejects a symlink inside an allowed root when its target escapes the root', async () => {
    const auth = createAuth()
    const linkPath = join(allowedRoot, 'escaped.mp4')
    await symlink(join(process.cwd(), 'package.json'), linkPath)

    await expect(auth.uploadFile({ filePath: linkPath })).rejects.toMatchObject({
      name: 'SparkError',
      code: 'VALIDATION_FAILED',
    })
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it('rejects directories and empty files before upload', async () => {
    const auth = createAuth()
    const directory = join(allowedRoot, 'folder.mp4')
    const emptyFile = join(allowedRoot, 'empty.mp4')
    await mkdir(directory)
    await writeFile(emptyFile, Buffer.alloc(0))

    await expect(auth.uploadFile({ filePath: directory })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(auth.uploadFile({ filePath: emptyFile })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it.each([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['image/avif', '.avif'],
    ['image/heic', '.heic'],
    ['image/heif', '.heif'],
    ['image/bmp', '.bmp'],
    ['image/tiff', '.tiff'],
    ['video/mp4', '.mp4'],
    ['video/quicktime', '.mov'],
    ['video/webm', '.webm'],
    ['video/x-m4v', '.m4v'],
    ['audio/mpeg', '.mp3'],
    ['audio/wav', '.wav'],
    ['audio/mp4', '.m4a'],
    ['audio/aac', '.aac'],
    ['audio/flac', '.flac'],
    ['audio/ogg', '.ogg'],
    ['audio/opus', '.opus'],
    ['audio/webm', '.weba'],
  ])('accepts %s data URLs and gives them a matching filename', async (mimeType, extension) => {
    const auth = createAuth()

    await auth.uploadFile({ dataUrl: `data:${mimeType};base64,AQID` })

    expect(mocks.fileUploads).toContainEqual(
      expect.objectContaining({
        fileName: `canvas-input${extension}`,
        mimeType,
      }),
    )
  })

  it.each(['image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream'])(
    'rejects unsafe or unknown data URL MIME type %s',
    async (mimeType) => {
      const auth = createAuth()

      await expect(
        auth.uploadFile({
          dataUrl: `data:${mimeType};base64,AQID`,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      expect(mocks.fileUploads).toHaveLength(0)
    },
  )

  it('uses the data URL MIME instead of a renderer-provided override', async () => {
    const auth = createAuth()

    await expect(
      auth.uploadFile({
        dataUrl: 'data:text/html;base64,AQID',
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it('corrects a renderer filename extension from the accepted data URL MIME', async () => {
    const auth = createAuth()

    await auth.uploadFile({
      dataUrl: 'data:video/x-m4v;base64,AQID',
      fileName: 'canvas-input-1.mp4',
    })

    expect(mocks.fileUploads).toContainEqual(
      expect.objectContaining({
        fileName: 'canvas-input-1.m4v',
        mimeType: 'video/x-m4v',
      }),
    )
  })

  it('strips directory segments from a renderer-provided filename', async () => {
    const auth = createAuth()

    await auth.uploadFile({
      dataUrl: 'data:image/png;base64,AQID',
      fileName: '../nested\\reference.png',
    })

    expect(mocks.fileUploads).toContainEqual(
      expect.objectContaining({
        fileName: 'reference.png',
        mimeType: 'image/png',
      }),
    )
  })

  it('rejects unknown file extensions even when the renderer supplies an allowed MIME', async () => {
    const auth = createAuth()
    const filePath = join(allowedRoot, 'payload.svg')
    await writeFile(filePath, Buffer.from('<svg/>'))

    await expect(
      auth.uploadFile({
        filePath,
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it('rejects a file MIME that is incompatible with its recognized extension', async () => {
    const auth = createAuth()
    const filePath = join(allowedRoot, 'clip.mp4')
    await writeFile(filePath, Buffer.from([1, 2, 3]))

    await expect(
      auth.uploadFile({
        filePath,
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it('recognizes allowed file extensions and preserves a compatible explicit MIME', async () => {
    const auth = createAuth()
    const audioPath = join(allowedRoot, 'voice.webm')
    const videoPath = join(allowedRoot, 'clip.m4v')
    await writeFile(audioPath, Buffer.from([1, 2, 3]))
    await writeFile(videoPath, Buffer.from([4, 5, 6]))

    await auth.uploadFile({ filePath: audioPath, mimeType: 'audio/webm' })
    await auth.uploadFile({ filePath: videoPath })

    expect(mocks.fileUploads).toEqual([
      expect.objectContaining({ fileName: 'voice.webm', mimeType: 'audio/webm' }),
      expect.objectContaining({ fileName: 'clip.m4v', mimeType: 'video/x-m4v' }),
    ])
  })

  it('keeps avatar uploads restricted to safe raster images', async () => {
    const auth = createAuth()

    await expect(
      auth.uploadAvatar({
        dataUrl: 'data:video/mp4;base64,AQID',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await auth.uploadAvatar({ dataUrl: 'data:image/avif;base64,AQID' })

    expect(mocks.avatarUploads).toEqual([
      expect.objectContaining({ fileName: 'canvas-input.avif', mimeType: 'image/avif' }),
    ])
  })

  it('rejects empty decoded data URLs', async () => {
    const auth = createAuth()

    await expect(
      auth.uploadFile({
        dataUrl: 'data:image/png;base64,',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it('rejects files larger than 100 MB before reading them', async () => {
    const auth = createAuth()
    const filePath = join(allowedRoot, 'oversized.mp4')
    await writeFile(filePath, Buffer.from([1]))
    await truncate(filePath, 100_000_001)

    await expect(auth.uploadFile({ filePath })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    expect(mocks.readFilePaths).not.toContain(filePath)
    expect(mocks.fileUploads).toHaveLength(0)
  })

  it('rejects data URLs whose decoded payload is larger than 100 MB', async () => {
    const auth = createAuth()
    const originalBufferFrom = Buffer.from
    const fromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((
      value: unknown,
      ...args: unknown[]
    ) => {
      if (value === 'oversized-payload' && args[0] === 'base64') {
        return { length: 100_000_001 } as Buffer
      }
      return Reflect.apply(originalBufferFrom, Buffer, [value, ...args])
    }) as typeof Buffer.from)

    try {
      await expect(
        auth.uploadFile({
          dataUrl: 'data:video/mp4;base64,oversized-payload',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
      expect(mocks.fileUploads).toHaveLength(0)
    } finally {
      fromSpy.mockRestore()
    }
  })
})
