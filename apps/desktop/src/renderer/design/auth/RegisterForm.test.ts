import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Spark Canvas registration footer', () => {
  it('does not present placeholder legal links as real agreements', () => {
    const source = readFileSync(join(__dirname, 'RegisterForm.tsx'), 'utf8')

    expect(source).not.toContain('href="#"')
    expect(source).not.toContain('注册即同意')
    expect(source).toContain('Spark 云账户')
  })
})
