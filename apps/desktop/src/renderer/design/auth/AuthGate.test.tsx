// @vitest-environment jsdom

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: {
    flow: 'login' as 'login' | 'register',
    keytarAvailable: true as boolean | null,
    setFlow: vi.fn(),
  },
}))

vi.mock('./AuthContext', () => ({
  useAuth: () => mocks.auth,
}))

vi.mock('./LoginForm', () => ({
  LoginForm: () => <div>LOGIN FORM</div>,
}))

vi.mock('./RegisterForm', () => ({
  RegisterForm: () => <div>REGISTER FORM</div>,
}))

vi.mock('../Icons', () => ({
  Icons: {
    Zap: () => <span />,
    Lock: () => <span />,
    Sparkles: () => <span />,
  },
}))

vi.mock('antd', () => ({
  Alert: ({ message }: { message: React.ReactNode }) => <div>{message}</div>,
}))

import { AuthGate } from './AuthGate'

describe('AuthGate Spark Canvas product copy', () => {
  beforeEach(() => {
    mocks.auth.flow = 'login'
    mocks.auth.keytarAvailable = true
    mocks.auth.setFlow.mockReset()
  })

  it('presents login as a video workbench without old Agent platform features', () => {
    const html = renderToStaticMarkup(<AuthGate />)

    expect(html).toContain('Spark Canvas')
    expect(html).toContain('视频')
    expect(html).toContain('本地项目')
    expect(html).not.toContain('SparkWork')
    expect(html).not.toContain('技能')
    expect(html).not.toContain('工作流')
    expect(html).not.toContain('MCP')
  })

  it('keeps registration focused on video creation', () => {
    mocks.auth.flow = 'register'

    const html = renderToStaticMarkup(<AuthGate />)

    expect(html).toContain('Spark Canvas')
    expect(html).toContain('视频创作')
    expect(html).toContain('第三方模型密钥')
    expect(html).not.toContain('SparkWork')
  })

  it('explains credential fallback without exposing repository repair commands', () => {
    mocks.auth.keytarAvailable = false

    const html = renderToStaticMarkup(<AuthGate />)

    expect(html).toContain('系统凭据库暂不可用')
    expect(html).toContain('本地项目')
    expect(html).not.toContain('仓库根目录')
    expect(html).not.toContain('pnpm')
    expect(html).not.toContain('electron-rebuild')
  })
})
