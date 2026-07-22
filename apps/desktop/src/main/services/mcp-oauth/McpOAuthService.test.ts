import { describe, expect, it } from 'vitest'

import { getMcpOAuthTokenService } from './McpOAuthService.js'

describe('MCP OAuth credential namespace', () => {
  it('uses the Spark Canvas service without accepting the old service name', () => {
    expect(getMcpOAuthTokenService('server-1')).toBe('spark-canvas-mcp-oauth:server-1')
    expect(getMcpOAuthTokenService('server-1')).not.toBe('spark-mcp-oauth:server-1')
  })
})
