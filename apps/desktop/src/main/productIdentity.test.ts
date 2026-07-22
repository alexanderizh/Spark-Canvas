import { describe, expect, it, vi } from 'vitest'

import {
  PRODUCT_IDENTITY,
  applyProductIdentity,
  resolveProductUserDataPath,
} from './productIdentity.js'

describe('Spark Canvas product identity', () => {
  it('uses the frozen standalone identity', () => {
    expect(PRODUCT_IDENTITY).toEqual({
      name: 'Spark Canvas',
      appId: 'com.spark.canvas.desktop',
      protocol: 'spark-canvas',
      cloudAuthService: 'SparkCanvas.CloudAuth',
      providerVaultService: 'spark-canvas',
      databaseFileName: 'spark-canvas.db',
      userDataDirectoryName: 'Spark Canvas',
      sessionDataDirectoryName: 'session-data',
    })
  })

  it('places userData in a product-specific directory', () => {
    expect(resolveProductUserDataPath('/Users/test/Library/Application Support')).toBe(
      '/Users/test/Library/Application Support/Spark Canvas',
    )
  })

  it('sets the runtime name and userData path before application startup', () => {
    const app = {
      getPath: vi.fn(() => '/Users/test/Library/Application Support'),
      setName: vi.fn(),
      setPath: vi.fn(),
    }
    const ensureDirectory = vi.fn()

    applyProductIdentity(app, ensureDirectory)

    expect(app.getPath).toHaveBeenCalledWith('appData')
    expect(app.setName).toHaveBeenCalledWith('Spark Canvas')
    expect(ensureDirectory).toHaveBeenCalledWith(
      '/Users/test/Library/Application Support/Spark Canvas',
      { recursive: true },
    )
    expect(ensureDirectory).toHaveBeenCalledWith(
      '/Users/test/Library/Application Support/Spark Canvas/session-data',
      { recursive: true },
    )
    expect(app.setPath).toHaveBeenCalledWith(
      'userData',
      '/Users/test/Library/Application Support/Spark Canvas',
    )
    expect(app.setPath).toHaveBeenCalledWith(
      'sessionData',
      '/Users/test/Library/Application Support/Spark Canvas/session-data',
    )
    expect(ensureDirectory.mock.invocationCallOrder[0]).toBeLessThan(
      app.setPath.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('supports an explicit appData root for isolated development E2E', () => {
    const app = {
      getPath: vi.fn(() => '/Users/test/Library/Application Support'),
      setName: vi.fn(),
      setPath: vi.fn(),
    }
    const ensureDirectory = vi.fn()

    applyProductIdentity(app, ensureDirectory, '/tmp/spark-canvas-e2e')

    expect(app.getPath).not.toHaveBeenCalled()
    expect(app.setPath).toHaveBeenCalledWith('userData', '/tmp/spark-canvas-e2e/Spark Canvas')
  })
})
