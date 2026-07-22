import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Spark Canvas standalone support copy', () => {
  it('describes local data and logout without claiming project sync or credential files', () => {
    const settings = readFileSync(join(__dirname, 'design/views/CanvasSettingsView.tsx'), 'utf8')
    const account = readFileSync(join(__dirname, 'design/views/AccountCenterView.tsx'), 'utf8')

    expect(settings).toContain('项目、数据库和缓存')
    expect(settings).not.toContain('凭据备份')
    expect(account).toContain('本地项目和模型配置不会被删除')
    expect(account).not.toContain('本机的同步数据')
  })
})
