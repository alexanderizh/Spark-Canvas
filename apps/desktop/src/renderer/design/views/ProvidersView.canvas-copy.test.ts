import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Spark Canvas model service copy', () => {
  it('uses video-canvas workflows instead of the old coding-agent product language', () => {
    const source = readFileSync(join(__dirname, 'ProvidersView.tsx'), 'utf8')

    expect(source).toContain('<h2>模型服务</h2>')
    expect(source).toContain('剧本拆解、分镜规划、长链制作任务')
    expect(source).toContain('Canvas Agent 和画布任务')
    expect(source).not.toContain('开发、重构、debug、测试、方案')
    expect(source).not.toContain('会显示在 Chat 和 Agent')
    expect(source).not.toContain('SDK 派生子 agent / Task 工具')
  })
})
