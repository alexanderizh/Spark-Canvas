import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Canvas standalone configuration guidance', () => {
  it('routes users to the visible model-service page instead of removed platform pages', () => {
    const api = readFileSync(join(__dirname, 'canvas.api.ts'), 'utf8')
    const inline = readFileSync(join(__dirname, 'CanvasInlineAiComposer.tsx'), 'utf8')
    const operation = readFileSync(join(__dirname, 'CanvasOperationPanel.tsx'), 'utf8')
    const combined = `${api}\n${inline}\n${operation}`

    expect(combined).toContain('主窗口「模型服务」')
    expect(combined).not.toContain('模型 / Agent 配置')
    expect(combined).not.toContain('「Agents」')
    expect(combined).not.toContain('请先到 Provider 绑定')
  })
})
