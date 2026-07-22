import { app, dialog } from 'electron'
import {
  ConnectorConnectionRepository,
  ProviderProfileRepository,
  SettingsRepository,
} from '@spark/storage'
import { createLogger } from '@spark/shared'
import {
  configureCredentialVaultPersistence,
  preloadSecrets,
  type KeystoreRef,
} from '@spark/shared/keystore'
import { getDatabase } from '../db.js'
import { createCredentialVaultPersistence } from './CredentialVaultPersistence.js'

const KEYCHAIN_DISCLOSURE_VERSION = 1
const log = createLogger('credential-vault:startup')

export async function initializeCredentialVault(): Promise<void> {
  try {
    configureCredentialVaultPersistence(createCredentialVaultPersistence())
    const refs = configuredSecretRefs()
    if (app.isPackaged && refs.length > 0) await showKeychainDisclosureOnce()
    await preloadSecrets(refs)
  } catch (error) {
    log.warn(
      `credential startup preparation skipped: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function configuredSecretRefs(): KeystoreRef[] {
  const database = getDatabase()
  const providerRefs = new ProviderProfileRepository(database)
    .listAll()
    .map((row) => row.keystore_ref)
    .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
  const connectorRefs = new ConnectorConnectionRepository(database)
    .listAll()
    .map((row) => row.keystore_ref)
    .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
  return [...new Set([...providerRefs, ...connectorRefs])] as KeystoreRef[]
}

async function showKeychainDisclosureOnce(): Promise<void> {
  if (process.platform !== 'darwin') return
  const settings = new SettingsRepository(getDatabase())
  if (settings.get('privacy', 'keychain-disclosure-version') === KEYCHAIN_DISCLOSURE_VERSION) return

  await dialog.showMessageBox({
    type: 'info',
    title: '为什么 Spark Canvas 需要访问钥匙串？',
    message: '您的模型密钥只保存在这台电脑上',
    detail:
      'Spark Canvas 不会把您的 API Key 上传或保存到平台服务器。为了避免明文保存，安装版会使用 macOS“登录”钥匙串保护这些机密信息。\n\n接下来如果 macOS 询问访问“spark-canvas”机密信息，请选择“始终允许”，这样以后启动时就不会重复询问。',
    buttons: ['我知道了，继续'],
    defaultId: 0,
    noLink: true,
  })
  settings.set('privacy', 'keychain-disclosure-version', KEYCHAIN_DISCLOSURE_VERSION)
}
