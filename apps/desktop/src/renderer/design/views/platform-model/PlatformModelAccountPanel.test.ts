import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(__dirname, 'PlatformModelAccountPanel.tsx'), 'utf8')

describe('Spark cloud account usage boundary', () => {
  it('renders cloud usage in the account page instead of routing to old settings', () => {
    expect(source).not.toContain("setTweak('settingsSection', 'usage')")
    expect(source).toContain('usage.logs.map')
    expect(source).toContain('累计消耗')
  })
})
