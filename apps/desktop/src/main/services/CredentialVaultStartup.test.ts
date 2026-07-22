import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configureCredentialVaultPersistence: vi.fn(),
  preloadSecrets: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@spark/shared/keystore', () => ({
  configureCredentialVaultPersistence: mocks.configureCredentialVaultPersistence,
  preloadSecrets: mocks.preloadSecrets,
}))

vi.mock('@spark/storage', () => ({
  ProviderProfileRepository: class {
    listAll() {
      return [{ keystore_ref: 'provider-ref' }, { keystore_ref: 'shared-ref' }]
    }
  },
  ConnectorConnectionRepository: class {
    listAll() {
      return [{ keystore_ref: 'connector-ref' }, { keystore_ref: 'shared-ref' }]
    }
  },
  SettingsRepository: class {},
}))

vi.mock('../db.js', () => ({ getDatabase: () => ({}) }))
vi.mock('./CredentialVaultPersistence.js', () => ({
  createCredentialVaultPersistence: () => ({ load: vi.fn(), save: vi.fn() }),
}))
vi.mock('@spark/shared', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showMessageBox: vi.fn() },
}))

import { initializeCredentialVault } from './CredentialVaultStartup.js'

describe('credential vault startup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('configures persistence and preloads configured secrets without Auth bootstrap', async () => {
    await initializeCredentialVault()

    expect(mocks.configureCredentialVaultPersistence).toHaveBeenCalledOnce()
    expect(mocks.preloadSecrets).toHaveBeenCalledWith([
      'provider-ref',
      'shared-ref',
      'connector-ref',
    ])
  })

  it('does not block application startup when credential preload is denied', async () => {
    mocks.preloadSecrets.mockRejectedValueOnce(new Error('User denied Keychain access'))

    await expect(initializeCredentialVault()).resolves.toBeUndefined()
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('User denied'))
  })
})
