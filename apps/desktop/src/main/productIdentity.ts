import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  APP_BUNDLE_ID,
  APP_NAME,
  APP_PROTOCOL,
  CLOUD_AUTH_SERVICE,
  DB_FILENAME_PROD,
  KEYCHAIN_SERVICE,
  SESSION_DATA_DIRECTORY_NAME,
  USER_DATA_DIRECTORY_NAME,
} from '@spark/shared'

export const PRODUCT_IDENTITY = Object.freeze({
  name: APP_NAME,
  appId: APP_BUNDLE_ID,
  protocol: APP_PROTOCOL,
  cloudAuthService: CLOUD_AUTH_SERVICE,
  providerVaultService: KEYCHAIN_SERVICE,
  databaseFileName: DB_FILENAME_PROD,
  userDataDirectoryName: USER_DATA_DIRECTORY_NAME,
  sessionDataDirectoryName: SESSION_DATA_DIRECTORY_NAME,
})

type ProductIdentityApp = {
  getPath(name: 'appData'): string
  setName(name: string): void
  setPath(name: 'userData' | 'sessionData', path: string): void
}

export function resolveProductUserDataPath(appDataPath: string): string {
  return join(appDataPath, PRODUCT_IDENTITY.userDataDirectoryName)
}

export function applyProductIdentity(
  app: ProductIdentityApp,
  ensureDirectory: typeof mkdirSync = mkdirSync,
  appDataPathOverride?: string,
): void {
  if (appDataPathOverride != null && !isAbsolute(appDataPathOverride)) {
    throw new Error('Spark Canvas appData override must be an absolute path')
  }
  const appDataPath = appDataPathOverride ?? app.getPath('appData')
  const userDataPath = resolveProductUserDataPath(appDataPath)
  const sessionDataPath = join(userDataPath, PRODUCT_IDENTITY.sessionDataDirectoryName)
  ensureDirectory(userDataPath, { recursive: true })
  ensureDirectory(sessionDataPath, { recursive: true })
  app.setName(PRODUCT_IDENTITY.name)
  app.setPath('userData', userDataPath)
  app.setPath('sessionData', sessionDataPath)
}
