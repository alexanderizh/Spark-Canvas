import { describe, expect, it } from 'vitest'
import {
  findPlatformModelRedeemCode,
  parsePlatformModelRedeemDeepLink,
} from './PlatformModelDeepLink.js'

describe('platform model redeem deep links', () => {
  it('extracts an encoded redemption code from app launch arguments', () => {
    expect(
      findPlatformModelRedeemCode([
        '/Applications/Spark Canvas.app',
        'spark-canvas://redeem?code=SPARK-CODE-123',
      ]),
    ).toBe('SPARK-CODE-123')
  })

  it('rejects unrelated schemes, routes, and unsafe code values', () => {
    expect(parsePlatformModelRedeemDeepLink('https://redeem?code=secret')).toBeNull()
    expect(parsePlatformModelRedeemDeepLink('spark-canvas://settings?code=secret')).toBeNull()
    expect(parsePlatformModelRedeemDeepLink('spark-canvas://redeem?code=line%0Abreak')).toBeNull()
    expect(parsePlatformModelRedeemDeepLink('spark-agent://redeem?code=legacy')).toBeNull()
  })
})
