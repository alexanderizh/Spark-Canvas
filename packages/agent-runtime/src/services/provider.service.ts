import type {
  ProviderProfile,
  ProviderHealthCheckResponse,
  ProviderFetchedModel,
  ProviderExportPayload,
  ProviderExportProfile,
  ProviderImportMode,
  ProviderImportResult,
  ProviderIconConfig,
} from '@spark/protocol'
import {
  isMediaApiType,
  isMediaCapabilityId,
  isMediaProviderKind,
  type MediaProviderKind,
  type MediaApiType,
  type MediaCapabilityId,
  type ProviderMediaDefaults,
  type ProviderMediaModelRef,
  ProviderMediaModelRefSchema,
  isProviderAllowedForRouterAdapter,
  type RoutingAdapter,
} from '@spark/protocol'
import {
  CLAUDE_AUTO_ROUTER_PROVIDER_ID,
  CLAUDE_AUTO_ROUTER_PROVIDER_NAME,
  CODEX_AUTO_ROUTER_PROVIDER_ID,
  CODEX_AUTO_ROUTER_PROVIDER_NAME,
  PROVIDER_EXPORT_VERSION,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CLI_PROVIDER_NAME,
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_PROVIDER_NAME,
  isBuiltInLocalCliProvider,
  isAutoRouterProvider,
  isLocalCodexCliProvider,
} from '@spark/protocol'
import { ProviderProfileRepository } from '@spark/storage'
import * as keystore from '@spark/shared/keystore'
import { createLogger } from '@spark/shared'
import { resolveProviderApiKey } from './provider-credential-resolver.js'

const log = createLogger('provider.service')
type ProviderModelType = NonNullable<ProviderProfile['modelType']>
type ImageGenApiType = NonNullable<ProviderProfile['imageApiType']>
type TextProviderKind = 'anthropic' | 'openai' | 'deepseek' | 'ollama' | 'openai-compatible'
const PROVIDER_MODEL_TYPES = new Set<ProviderModelType>([
  'image',
  'text',
  'multimodal',
  'voice',
  'video',
])
const IMAGE_API_TYPES = new Set<ImageGenApiType>(['sync', 'async', 'auto'])
const TEXT_PROVIDER_KINDS = new Set<TextProviderKind>([
  'anthropic',
  'openai',
  'deepseek',
  'ollama',
  'openai-compatible',
])
const PROVIDER_HTTP_TIMEOUT_MS = 8_000
const PROVIDER_CONNECTION_TIMEOUT_MS = 15_000
const MODELS_ERROR_BODY_MAX_CHARS = 512
export const PLATFORM_NEWAPI_PROVIDER_ID = 'spark-platform-newapi'

function rowToProfile(row: {
  id: string
  provider_type: string
  name: string
  config_json: string
  keystore_ref: string | null
  is_default: number
  created_at: string
}): ProviderProfile {
  const rawConfig = JSON.parse(row.config_json) as ProviderConfig
  const config = isBuiltInLocalCliProvider(row)
    ? normalizeLocalCliProviderConfig(row.id, rawConfig)
    : normalizeProviderConfigForProviderType(row.provider_type, rawConfig)
  const name = isLocalCodexCliProvider(row)
    ? LOCAL_CODEX_CLI_PROVIDER_NAME
    : row.id === LOCAL_CLI_PROVIDER_ID
      ? LOCAL_CLI_PROVIDER_NAME
      : row.name
  return {
    id: row.id,
    name,
    provider: normalizeProviderType(row.provider_type),
    defaultModel: config.defaultModel,
    modelIds: config.modelIds,
    ...(config.availableModelIds !== undefined && { availableModelIds: config.availableModelIds }),
    ...(config.providerIcon !== undefined && { providerIcon: config.providerIcon }),
    ...(config.apiEndpoint !== undefined && { apiEndpoint: config.apiEndpoint }),
    ...(config.codexApiKind !== undefined && { codexApiKind: config.codexApiKind }),
    supportsMillionContext: config.supportsMillionContext === true,
    ...(typeof config.contextWindow === 'number' &&
      config.contextWindow > 0 && { contextWindow: config.contextWindow }),
    ...(typeof config.maxTokens === 'number' &&
      config.maxTokens > 0 && { maxTokens: config.maxTokens }),
    ...(config.haikuModel !== undefined && { haikuModel: config.haikuModel }),
    ...(config.sonnetModel !== undefined && { sonnetModel: config.sonnetModel }),
    ...(config.opusModel !== undefined && { opusModel: config.opusModel }),
    ...(config.modelType !== undefined && { modelType: normalizeModelType(config.modelType) }),
    ...(config.imageProvider !== undefined && { imageProvider: config.imageProvider }),
    ...(config.imageApiType !== undefined && { imageApiType: config.imageApiType }),
    ...(config.mediaProvider !== undefined && { mediaProvider: config.mediaProvider }),
    ...(config.mediaApiType !== undefined && { mediaApiType: config.mediaApiType }),
    ...(config.mediaCapabilities !== undefined && { mediaCapabilities: config.mediaCapabilities }),
    ...(config.mediaDefaults !== undefined && { mediaDefaults: config.mediaDefaults }),
    ...(config.mediaModelRefs !== undefined && { mediaModelRefs: config.mediaModelRefs }),
    ...(config.managed === true && { managed: true }),
    ...(config.managedType !== undefined && { managedType: config.managedType }),
    ...(config.managedOwnerUserId !== undefined && {
      managedOwnerUserId: config.managedOwnerUserId,
    }),
    ...(config.credentialState !== undefined && { credentialState: config.credentialState }),
    keystoreRef: row.keystore_ref ?? '',
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
  }
}

function createAutoRouterProvider(adapter: 'claude' | 'codex'): ProviderProfile {
  const isClaude = adapter === 'claude'
  return {
    id: isClaude ? CLAUDE_AUTO_ROUTER_PROVIDER_ID : CODEX_AUTO_ROUTER_PROVIDER_ID,
    name: isClaude ? CLAUDE_AUTO_ROUTER_PROVIDER_NAME : CODEX_AUTO_ROUTER_PROVIDER_NAME,
    provider: isClaude ? 'anthropic' : 'openai',
    defaultModel: '',
    modelIds: [],
    ...(isClaude ? {} : { codexApiKind: 'responses' as const }),
    supportsMillionContext: false,
    modelType: 'text',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
  }
}

function hasRouteableTextProvider(profiles: ProviderProfile[], adapter: RoutingAdapter): boolean {
  return profiles.some((profile) => {
    if (isBuiltInLocalCliProvider(profile) || isAutoRouterProvider(profile)) return false
    if (profile.codexApiKind === 'embedding') return false
    if (!isProviderAllowedForRouterAdapter(adapter, profile)) return false
    return providerModelIds(profile).length > 0
  })
}

function providerModelIds(profile: ProviderProfile): string[] {
  const ids = profile.modelIds.length > 0 ? profile.modelIds : [profile.defaultModel]
  return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))]
}

export class ProviderService {
  constructor(private readonly repo: ProviderProfileRepository) {}

  async listProviders(): Promise<ProviderProfile[]> {
    const profiles = this.repo.listAll().map(rowToProfile)
    const visibleProfiles = profiles.filter((profile) => {
      if (isBuiltInLocalCliProvider(profile)) return false
      if (profile.managed === true && profile.credentialState === 'unavailable') return false
      return true
    })
    const routers: ProviderProfile[] = []
    if (hasRouteableTextProvider(visibleProfiles, 'claude')) {
      routers.push(createAutoRouterProvider('claude'))
    }
    if (hasRouteableTextProvider(visibleProfiles, 'codex')) {
      routers.push(createAutoRouterProvider('codex'))
    }
    return [...visibleProfiles, ...routers]
  }

  /**
   * 按需返回单个可编辑 Provider 的明文 Key，供受信任的编辑界面回显。
   * 调用方不得记录、持久化或批量请求返回值。
   */
  async getProviderApiKey(id: string): Promise<string> {
    const row = this.repo.get(id)
    if (!row) throw new Error(`Provider not found: ${id}`)
    if (isManagedProviderRow(row)) {
      throw new Error('平台官方 Provider 由系统管理，不能读取凭据')
    }
    if (!row.keystore_ref) return ''
    return (await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef)) ?? ''
  }

  async createProvider(params: {
    name: string
    provider: string
    defaultModel?: string
    modelIds?: string[]
    providerIcon?: ProviderIconConfig
    model?: string
    apiEndpoint?: string
    codexApiKind?: 'chat' | 'responses' | 'embedding'
    supportsMillionContext?: boolean
    contextWindow?: number
    maxTokens?: number
    haikuModel?: string
    sonnetModel?: string
    opusModel?: string
    modelType?: string
    imageProvider?: string | null
    imageApiType?: 'sync' | 'async' | 'auto' | null
    mediaProvider?: MediaProviderKind | null
    mediaApiType?: MediaApiType | null
    mediaCapabilities?: MediaCapabilityId[]
    mediaDefaults?: ProviderMediaDefaults
    mediaModelRefs?: ProviderMediaModelRef[]
    apiKey: string
    isDefault?: boolean
  }): Promise<ProviderProfile> {
    const id = crypto.randomUUID()
    const providerType = normalizeProviderType(params.provider)
    const defaultModel = params.defaultModel ?? params.model
    if (defaultModel == null || defaultModel.trim().length === 0) {
      throw new Error('Provider defaultModel is required')
    }
    const hasApiKey = params.apiKey != null && params.apiKey.length > 0
    const ref = hasApiKey ? keystore.makeKeystoreRef(providerType, id) : ''
    if (hasApiKey) {
      await keystore.setSecret(ref as keystore.KeystoreRef, params.apiKey)
      log.info(
        `Stored API key for provider=${providerType} id=${id} key=${keystore.maskSecret(params.apiKey)}`,
      )
    } else {
      log.info(
        `Created provider without API key (local CLI / pending key): provider=${providerType} id=${id}`,
      )
    }

    if (params.isDefault) {
      // clear existing defaults first
      this.repo.listAll().forEach((r) => {
        if (r.is_default) this.repo.update(r.id, {})
      })
    }

    const row = this.repo.create({
      id,
      providerType,
      name: params.name,
      config: normalizeProviderConfigForProviderType(providerType, {
        defaultModel,
        ...(params.modelIds !== undefined && { modelIds: params.modelIds }),
        ...(params.providerIcon !== undefined && { providerIcon: params.providerIcon }),
        ...(params.apiEndpoint !== undefined && { apiEndpoint: params.apiEndpoint }),
        ...(params.codexApiKind !== undefined && { codexApiKind: params.codexApiKind }),
        ...(params.supportsMillionContext !== undefined && {
          supportsMillionContext: params.supportsMillionContext,
        }),
        ...(params.contextWindow !== undefined &&
          params.contextWindow > 0 && { contextWindow: Math.floor(params.contextWindow) }),
        ...(params.maxTokens !== undefined &&
          params.maxTokens > 0 && { maxTokens: Math.floor(params.maxTokens) }),
        ...(params.haikuModel !== undefined &&
          params.haikuModel.trim().length > 0 && { haikuModel: params.haikuModel.trim() }),
        ...(params.sonnetModel !== undefined &&
          params.sonnetModel.trim().length > 0 && { sonnetModel: params.sonnetModel.trim() }),
        ...(params.opusModel !== undefined &&
          params.opusModel.trim().length > 0 && { opusModel: params.opusModel.trim() }),
        ...(params.modelType !== undefined && { modelType: normalizeModelType(params.modelType) }),
        ...(params.imageProvider !== undefined && { imageProvider: params.imageProvider }),
        ...(params.imageApiType !== undefined && { imageApiType: params.imageApiType }),
        ...(params.mediaProvider !== undefined && { mediaProvider: params.mediaProvider }),
        ...(params.mediaApiType !== undefined && { mediaApiType: params.mediaApiType }),
        ...(params.mediaCapabilities !== undefined && {
          mediaCapabilities: params.mediaCapabilities,
        }),
        ...(params.mediaDefaults !== undefined && { mediaDefaults: params.mediaDefaults }),
        ...(params.mediaModelRefs !== undefined && { mediaModelRefs: params.mediaModelRefs }),
      }),
      keystoreRef: ref,
      isDefault: params.isDefault ?? false,
    })

    if (params.isDefault) {
      this.repo.setDefault(id)
    }

    return rowToProfile(row)
  }

  async updateProvider(params: {
    id: string
    name?: string
    defaultModel?: string
    modelIds?: string[]
    providerIcon?: ProviderIconConfig | null
    model?: string
    apiEndpoint?: string | null
    codexApiKind?: 'chat' | 'responses' | 'embedding'
    supportsMillionContext?: boolean
    /** 0 清除自定义窗口；正整数设置；undefined 不修改 */
    contextWindow?: number
    /** 0 清除默认最大输出；正整数设置；undefined 不修改 */
    maxTokens?: number
    /** null 清除该档自定义；string 设置；undefined 不修改 */
    haikuModel?: string | null
    sonnetModel?: string | null
    opusModel?: string | null
    modelType?: string
    imageProvider?: string | null
    imageApiType?: 'sync' | 'async' | 'auto' | null
    mediaProvider?: MediaProviderKind | null
    mediaApiType?: MediaApiType | null
    mediaCapabilities?: MediaCapabilityId[]
    mediaDefaults?: ProviderMediaDefaults
    mediaModelRefs?: ProviderMediaModelRef[]
    apiKey?: string
    isDefault?: boolean
  }): Promise<ProviderProfile> {
    const existing = this.repo.get(params.id)
    if (!existing) throw new Error(`Provider not found: ${params.id}`)
    if (isManagedProviderRow(existing)) {
      throw new Error('平台官方 Provider 由系统管理，不能手动编辑')
    }

    let updatedKeystoreRef: string | undefined
    if (params.apiKey !== undefined) {
      const ref =
        existing.keystore_ref || keystore.makeKeystoreRef(existing.provider_type, params.id)
      await keystore.setSecret(ref as keystore.KeystoreRef, params.apiKey)
      updatedKeystoreRef = ref
      log.info(`Updated API key for id=${params.id} key=${keystore.maskSecret(params.apiKey)}`)
    }

    const existingConfig = normalizeProviderConfigForProviderType(
      existing.provider_type,
      JSON.parse(existing.config_json) as ProviderConfig,
    )
    const nextDefaultModel = params.defaultModel ?? params.model
    const tierTouched =
      params.haikuModel !== undefined ||
      params.sonnetModel !== undefined ||
      params.opusModel !== undefined
    const mediaTouched =
      params.mediaProvider !== undefined ||
      params.mediaApiType !== undefined ||
      params.mediaCapabilities !== undefined ||
      params.mediaDefaults !== undefined ||
      params.mediaModelRefs !== undefined
    const newConfig =
      nextDefaultModel !== undefined ||
      params.modelIds !== undefined ||
      params.providerIcon !== undefined ||
      params.apiEndpoint !== undefined ||
      params.codexApiKind !== undefined ||
      params.supportsMillionContext !== undefined ||
      params.contextWindow !== undefined ||
      params.maxTokens !== undefined ||
      tierTouched ||
      params.modelType !== undefined ||
      params.imageProvider !== undefined ||
      params.imageApiType !== undefined ||
      mediaTouched
        ? { ...existingConfig }
        : undefined

    if (newConfig !== undefined && nextDefaultModel !== undefined) {
      newConfig.defaultModel = nextDefaultModel
      if (params.modelIds === undefined) {
        newConfig.modelIds = normalizeModelIds(nextDefaultModel, newConfig.modelIds)
      }
    }
    if (newConfig !== undefined && params.modelIds !== undefined) {
      newConfig.modelIds = normalizeModelIds(
        nextDefaultModel ?? newConfig.defaultModel,
        params.modelIds,
      )
    }
    if (newConfig !== undefined && params.providerIcon !== undefined) {
      if (params.providerIcon == null) delete newConfig.providerIcon
      else newConfig.providerIcon = params.providerIcon
    }
    if (newConfig !== undefined && params.apiEndpoint !== undefined) {
      if (params.apiEndpoint === null) {
        delete newConfig.apiEndpoint
      } else {
        newConfig.apiEndpoint = params.apiEndpoint
      }
    }
    if (newConfig !== undefined && params.codexApiKind !== undefined) {
      newConfig.codexApiKind = params.codexApiKind
    }
    if (newConfig !== undefined && params.supportsMillionContext !== undefined) {
      newConfig.supportsMillionContext = params.supportsMillionContext
    }
    if (newConfig !== undefined && params.contextWindow !== undefined) {
      if (params.contextWindow > 0) {
        newConfig.contextWindow = Math.floor(params.contextWindow)
      } else {
        delete newConfig.contextWindow
      }
    }
    if (newConfig !== undefined && params.maxTokens !== undefined) {
      if (params.maxTokens > 0) {
        newConfig.maxTokens = Math.floor(params.maxTokens)
      } else {
        delete newConfig.maxTokens
      }
    }
    if (newConfig !== undefined && params.haikuModel !== undefined) {
      const v = params.haikuModel?.trim()
      if (v != null && v.length > 0) newConfig.haikuModel = v
      else delete newConfig.haikuModel
    }
    if (newConfig !== undefined && params.sonnetModel !== undefined) {
      const v = params.sonnetModel?.trim()
      if (v != null && v.length > 0) newConfig.sonnetModel = v
      else delete newConfig.sonnetModel
    }
    if (newConfig !== undefined && params.opusModel !== undefined) {
      const v = params.opusModel?.trim()
      if (v != null && v.length > 0) newConfig.opusModel = v
      else delete newConfig.opusModel
    }
    if (newConfig !== undefined && params.modelType !== undefined) {
      newConfig.modelType = normalizeModelType(params.modelType)
    }
    if (newConfig !== undefined && params.imageProvider !== undefined) {
      const v = params.imageProvider?.trim()
      if (v != null && v.length > 0) newConfig.imageProvider = v
      else delete newConfig.imageProvider
    }
    if (newConfig !== undefined && params.imageApiType !== undefined) {
      if (params.imageApiType != null) newConfig.imageApiType = params.imageApiType
      else delete newConfig.imageApiType
    }
    // ── 多媒体能力更新 ──
    // 注意：image→media 同步在最后通过 normalizeProviderConfig 统一处理，
    // 这里只把显式传入的字段写入 newConfig，避免覆盖 image 分支的兜底。
    if (newConfig !== undefined && params.mediaProvider !== undefined) {
      if (params.mediaProvider == null) delete newConfig.mediaProvider
      else newConfig.mediaProvider = params.mediaProvider
    }
    if (newConfig !== undefined && params.mediaApiType !== undefined) {
      if (params.mediaApiType == null) delete newConfig.mediaApiType
      else newConfig.mediaApiType = params.mediaApiType
    }
    if (newConfig !== undefined && params.mediaCapabilities !== undefined) {
      newConfig.mediaCapabilities = params.mediaCapabilities
    }
    if (newConfig !== undefined && params.mediaDefaults !== undefined) {
      newConfig.mediaDefaults = params.mediaDefaults
    }
    if (newConfig !== undefined && params.mediaModelRefs !== undefined) {
      newConfig.mediaModelRefs = params.mediaModelRefs
    }
    // 重新走 normalize，确保 image→media 同步、能力兜底、枚举校验一致
    if (newConfig !== undefined) {
      Object.assign(
        newConfig,
        normalizeProviderConfigForProviderType(existing.provider_type, newConfig),
      )
    }

    this.repo.update(params.id, {
      ...(params.name !== undefined && { name: params.name }),
      ...(newConfig !== undefined && { config: newConfig }),
      ...(updatedKeystoreRef !== undefined && { keystoreRef: updatedKeystoreRef }),
    })

    if (params.isDefault) {
      this.repo.setDefault(params.id)
    }

    const updated = this.repo.get(params.id)!
    return rowToProfile(updated)
  }

  async deleteProvider(id: string): Promise<void> {
    if (
      id === LOCAL_CLI_PROVIDER_ID ||
      id === LOCAL_CODEX_CLI_PROVIDER_ID ||
      isAutoRouterProvider(id)
    ) {
      throw new Error('Cannot delete the built-in provider')
    }
    const row = this.repo.get(id)
    if (!row) throw new Error(`Provider not found: ${id}`)
    if (isManagedProviderRow(row)) throw new Error('平台官方 Provider 由系统管理，不能删除')

    if (row.keystore_ref) {
      await keystore.deleteSecret(row.keystore_ref as keystore.KeystoreRef)
    }
    this.repo.delete(id)
  }

  async healthCheck(id: string): Promise<ProviderHealthCheckResponse> {
    log.info(`healthCheck started, id=${id}`)
    const row = this.repo.get(id)
    if (!row) {
      log.warn(`healthCheck failed: provider not found, id=${id}`)
      return { healthy: false, errorMessage: `Provider not found: ${id}` }
    }

    if (isManagedProviderRow(row)) {
      try {
        const apiKey = await resolveProviderApiKey(row)
        return apiKey
          ? { healthy: true, latencyMs: 0 }
          : { healthy: false, errorMessage: '平台模型凭据尚未就绪' }
      } catch (error) {
        return {
          healthy: false,
          errorMessage: error instanceof Error ? error.message : '平台模型凭据恢复失败',
        }
      }
    }

    if (!row.keystore_ref) {
      log.warn(`healthCheck failed: no API key configured, id=${id}`)
      return { healthy: false, errorMessage: 'No API key configured' }
    }

    const apiKey = await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef)
    if (!apiKey) {
      log.warn(`healthCheck failed: API key not found in keychain, id=${id}`)
      return { healthy: false, errorMessage: 'API key not found in keychain' }
    }

    const config = normalizeProviderConfigForProviderType(
      row.provider_type,
      JSON.parse(row.config_json) as ProviderConfig,
    )
    log.debug(`healthCheck delegating to testConnection, id=${id}, provider=${row.provider_type}`)
    return this.testConnection({
      id,
      provider: normalizeProviderType(row.provider_type),
      ...(config.apiEndpoint !== undefined ? { apiEndpoint: config.apiEndpoint } : {}),
      defaultModel: config.defaultModel,
      ...(config.codexApiKind !== undefined ? { codexApiKind: config.codexApiKind } : {}),
      apiKey,
    })
  }

  async testConnection(params: {
    id?: string
    provider: string
    apiEndpoint?: string | null
    defaultModel: string
    codexApiKind?: 'chat' | 'responses' | 'embedding'
    apiKey?: string
  }): Promise<ProviderHealthCheckResponse> {
    const providerType = normalizeProviderType(params.provider)
    log.info(
      `testConnection started, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
        `model=${params.defaultModel}, codexApiKind=${params.codexApiKind ?? 'chat'}`,
    )
    const apiKey = await this.resolveProviderApiKey(params.id, params.apiKey)
    if (!apiKey) {
      log.warn(
        `testConnection aborted: no API key, provider=${providerType}, id=${params.id ?? '(draft)'}`,
      )
      return { healthy: false, errorMessage: 'No API key configured' }
    }

    const endpoint = await this.resolveProviderEndpoint(params.id, params.apiEndpoint)
    const defaultModel = params.defaultModel.trim()
    if (!defaultModel) {
      log.warn(
        `testConnection aborted: default model missing, provider=${providerType}, ` +
          `id=${params.id ?? '(draft)'}`,
      )
      return { healthy: false, errorMessage: 'Default model is required' }
    }

    const resolvedEndpoint =
      providerType === 'anthropic' ? endpoint : (endpoint ?? getDefaultEndpointBase(providerType))
    log.debug(
      `testConnection pinging endpoint=${resolvedEndpoint ?? '(default)'}, ` +
        `provider=${providerType}, id=${params.id ?? '(draft)'}`,
    )

    const start = Date.now()

    try {
      const res =
        providerType === 'anthropic'
          ? await fetchAnthropicMessagesPing(endpoint, apiKey, defaultModel)
          : await fetchOpenAiCompatiblePing(
              endpoint ?? getDefaultEndpointBase(providerType),
              apiKey,
              defaultModel,
              params.codexApiKind ?? 'chat',
            )
      const latencyMs = Date.now() - start
      if (res.ok || res.status === 401) {
        // 401 means key is wrong but endpoint is reachable
        if (res.ok) {
          log.info(
            `testConnection success, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
              `latencyMs=${latencyMs}, status=${res.status}`,
          )
          return { healthy: true, latencyMs }
        }
        log.warn(
          `testConnection auth-failed, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
            `latencyMs=${latencyMs}, status=${res.status}`,
        )
        return { healthy: false, latencyMs, errorMessage: `HTTP ${res.status}` }
      }
      log.warn(
        `testConnection failed, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
          `latencyMs=${latencyMs}, status=${res.status}`,
      )
      return { healthy: false, latencyMs, errorMessage: `HTTP ${res.status}` }
    } catch (err) {
      const latencyMs = Date.now() - start
      log.warn(
        `testConnection threw, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
          `latencyMs=${latencyMs}, error=${err instanceof Error ? err.message : String(err)}`,
      )
      return {
        healthy: false,
        latencyMs,
        errorMessage: formatProviderConnectionError(err, PROVIDER_CONNECTION_TIMEOUT_MS),
      }
    }
  }

  async fetchModels(params: {
    id?: string
    provider: string
    apiEndpoint?: string | null
    apiKey?: string
    modelsUrl?: string | null
    isFullUrl?: boolean
  }): Promise<ProviderFetchedModel[]> {
    const providerType = normalizeProviderType(params.provider)
    log.info(
      `fetchModels started, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
        `isFullUrl=${params.isFullUrl === true}`,
    )
    const apiKey = await this.resolveProviderApiKey(params.id, params.apiKey)
    if (!apiKey) {
      log.warn(
        `fetchModels aborted: no API key, provider=${providerType}, id=${params.id ?? '(draft)'}`,
      )
      throw new Error('API Key is required to fetch models')
    }

    const endpoint = await this.resolveProviderEndpoint(params.id, params.apiEndpoint)
    const baseUrl = endpoint ?? getDefaultEndpointBase(providerType)
    const candidates = getModelsUrlCandidates(
      baseUrl,
      params.isFullUrl === true,
      params.modelsUrl ?? null,
    )
    if (candidates.length === 0) {
      log.warn(
        `fetchModels aborted: cannot derive endpoint, provider=${providerType}, ` +
          `id=${params.id ?? '(draft)'}, baseUrl=${baseUrl ?? '(none)'}`,
      )
      throw new Error('Cannot derive models endpoint')
    }
    log.debug(
      `fetchModels trying ${candidates.length} endpoint(s), provider=${providerType}, ` +
        `id=${params.id ?? '(draft)'}`,
    )

    let lastNotFound: string | null = null
    for (const url of candidates) {
      const res = await fetch(url, {
        headers: getModelsRequestHeaders(providerType, apiKey),
        signal: AbortSignal.timeout(PROVIDER_HTTP_TIMEOUT_MS),
      })
      if (res.ok) {
        const json = (await res.json()) as ModelsListResponse
        const models = normalizeFetchedModels(json)
        log.info(
          `fetchModels success, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
            `url=${url}, count=${models.length}`,
        )
        return models
      }
      const body = truncateResponseBody(await res.text().catch(() => ''))
      log.warn(
        `fetchModels endpoint failed, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
          `url=${url}, status=${res.status}, body="${body}"`,
      )
      if (res.status === 404 || res.status === 405) {
        lastNotFound = `HTTP ${res.status}: ${body}`
        continue
      }
      throw new Error(`HTTP ${res.status}: ${body}`)
    }
    log.warn(
      `fetchModels all-endpoints-failed, provider=${providerType}, id=${params.id ?? '(draft)'}, ` +
        `lastNotFound=${lastNotFound ?? '(none)'}`,
    )
    throw new Error(`All model endpoints failed: ${lastNotFound ?? 'no candidates'}`)
  }

  async ensureManagedNewApiProvider(params: {
    ownerUserId: string
    baseUrl: string
    modelIds: string[]
    apiKey: string
    credentialState?: 'ready' | 'session_conflict' | 'quota_exhausted' | 'unavailable'
  }): Promise<ProviderProfile> {
    const availableModelIds = [
      ...new Set(params.modelIds.map((model) => model.trim()).filter(Boolean)),
    ]
    const existing = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
    const existingConfig =
      existing && isManagedProviderRow(existing)
        ? normalizeProviderConfig(JSON.parse(existing.config_json) as ProviderConfig)
        : null
    const preferredModelIds =
      existingConfig?.modelIds.filter((model) => availableModelIds.includes(model)) ?? []
    const modelIds = preferredModelIds.length > 0 ? preferredModelIds : availableModelIds
    const defaultModel =
      existingConfig && modelIds.includes(existingConfig.defaultModel)
        ? existingConfig.defaultModel
        : modelIds[0]
    if (!defaultModel) throw new Error('平台账户当前没有可用模型')
    const keystoreRef = keystore.makeKeystoreRef(
      'newapi',
      `spark-user-${params.ownerUserId}-api-key`,
    )
    await keystore.setSecret(keystoreRef, params.apiKey)
    const config = normalizeProviderConfig({
      defaultModel,
      modelIds,
      availableModelIds,
      // Claude/Anthropic SDK appends /v1/messages itself. Keeping the OpenAI-style
      // /v1 suffix here would send managed models to /v1/v1/messages.
      apiEndpoint: params.baseUrl.replace(/\/+$/, ''),
      modelType: 'text',
      managed: true,
      managedType: 'newapi',
      managedOwnerUserId: params.ownerUserId,
      credentialState: params.credentialState ?? 'ready',
    })
    if (existing) {
      this.repo.update(PLATFORM_NEWAPI_PROVIDER_ID, {
        providerType: 'anthropic',
        name: 'Spark 平台模型',
        config,
        enabled: true,
        keystoreRef,
      })
      const updated = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
      if (!updated) throw new Error('平台官方 Provider 更新后无法读取')
      return rowToProfile(updated)
    }
    return rowToProfile(
      this.repo.create({
        id: PLATFORM_NEWAPI_PROVIDER_ID,
        providerType: 'anthropic',
        name: 'Spark 平台模型',
        config,
        keystoreRef,
        isDefault: false,
      }),
    )
  }

  async updateManagedNewApiModelPreferences(params: {
    modelIds: string[]
    defaultModel: string
  }): Promise<ProviderProfile> {
    const row = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
    if (!row || !isManagedProviderRow(row)) throw new Error('平台官方 Provider 尚未就绪')
    const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
    const availableModelIds = config.availableModelIds ?? config.modelIds
    const selected = [
      ...new Set(
        params.modelIds
          .map((model) => model.trim())
          .filter((model) => availableModelIds.includes(model)),
      ),
    ]
    const firstSelected = selected[0]
    if (!firstSelected) throw new Error('至少启用一个平台模型')
    const requestedDefault = params.defaultModel.trim()
    const defaultModel = selected.includes(requestedDefault) ? requestedDefault : firstSelected
    const modelIds = normalizeModelIds(defaultModel, selected)
    this.repo.update(PLATFORM_NEWAPI_PROVIDER_ID, {
      config: { ...config, defaultModel, modelIds, availableModelIds },
    })
    const updated = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
    if (!updated) throw new Error('平台官方 Provider 更新后无法读取')
    return rowToProfile(updated)
  }

  async disableManagedNewApiProvider(ownerUserId?: string): Promise<void> {
    const row = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
    if (!row || !isManagedProviderRow(row)) return
    const config = JSON.parse(row.config_json) as ProviderConfig
    if (ownerUserId && config.managedOwnerUserId !== ownerUserId) return
    if (row.keystore_ref) {
      await keystore.deleteSecret(row.keystore_ref as keystore.KeystoreRef)
    }
    this.repo.update(PLATFORM_NEWAPI_PROVIDER_ID, {
      enabled: false,
      config: { ...config, credentialState: 'unavailable' },
    })
  }

  setManagedNewApiCredentialState(
    ownerUserId: string,
    credentialState: 'ready' | 'session_conflict' | 'quota_exhausted' | 'unavailable',
  ): void {
    const row = this.repo.get(PLATFORM_NEWAPI_PROVIDER_ID)
    if (!row || !isManagedProviderRow(row)) return
    const config = JSON.parse(row.config_json) as ProviderConfig
    if (config.managedOwnerUserId !== ownerUserId) return
    this.repo.update(PLATFORM_NEWAPI_PROVIDER_ID, {
      config: { ...config, credentialState },
    })
  }

  private async resolveProviderApiKey(
    id: string | undefined,
    apiKey: string | undefined,
  ): Promise<string> {
    const direct = apiKey?.trim()
    if (direct) return direct
    if (!id) return ''
    const row = this.repo.get(id)
    if (!row?.keystore_ref) return ''
    return (await keystore.getSecret(row.keystore_ref as keystore.KeystoreRef))?.trim() ?? ''
  }

  private async resolveProviderEndpoint(
    id: string | undefined,
    apiEndpoint: string | null | undefined,
  ): Promise<string | undefined> {
    const direct = apiEndpoint?.trim()
    if (direct) return direct
    if (apiEndpoint === null) return undefined
    if (!id) return undefined
    const row = this.repo.get(id)
    if (!row) return undefined
    const config = normalizeProviderConfig(JSON.parse(row.config_json) as ProviderConfig)
    return config.apiEndpoint
  }

  /**
   * 导出 provider 配置为 ExportPayload（不含 apiKey）。
   *
   * - ids 为空时导出全部
   * - id 不存在时静默跳过（不抛错），方便前端多选时无需严格校验
   * - Keychain 凭据不读取、不写入普通导出文件
   */
  async exportProviders(ids: string[] = []): Promise<ProviderExportPayload> {
    const rows = this.repo.listAll()
    const idSet = ids.length > 0 ? new Set(ids) : null
    const profiles: ProviderExportProfile[] = []
    for (const row of rows) {
      if (idSet !== null && !idSet.has(row.id)) continue
      if (isManagedProviderRow(row)) continue
      profiles.push(rowToExportProfile(row))
    }
    return {
      version: PROVIDER_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      exportedBy: 'spark-canvas',
      profiles,
    }
  }

  /**
   * 导入 ExportPayload 到数据库。
   *
   * - 模式 merge：按 name 去重，已存在则跳过（计入 skipped）
   * - 模式 replace：按 name 去重，已存在则更新（保留本地 keystoreRef，更新 apiKey）
   * - 单个 profile 失败不中断整体流程；错误累加到 errors
   * - 导入新建的 profile 强制 isDefault=false（避免覆盖本地默认）
   * - 导入更新的 profile 保留原 isDefault 标志
   * - 若 payload 中包含 apiKey，写入 Keychain；否则保留本地已有的 key
   */
  async importProviders(
    payload: ProviderExportPayload,
    mode: ProviderImportMode,
  ): Promise<ProviderImportResult> {
    const result: ProviderImportResult = { imported: 0, skipped: 0, errors: [] }
    if (payload.profiles.length === 0) return result

    const existing = new Map<string, ReturnType<typeof this.repo.listAll>[number]>()
    for (const row of this.repo.listAll()) {
      existing.set(row.name, row)
    }

    for (const profile of payload.profiles) {
      try {
        const match = existing.get(profile.name)
        if (match != null) {
          if (isManagedProviderRow(match)) {
            result.skipped += 1
            result.errors.push(`平台官方 Provider「${profile.name}」不能被导入覆盖`)
            continue
          }
          if (mode === 'merge') {
            result.skipped += 1
            continue
          }
          // replace: 更新已存在的（保留 keystoreRef、本地 isDefault）
          // 若导入数据包含 apiKey，则更新 Keychain 中的 key
          if (profile.apiKey && match.keystore_ref) {
            await keystore.setSecret(match.keystore_ref as keystore.KeystoreRef, profile.apiKey)
            log.info(`Updated API key during import for id=${match.id} name=${profile.name}`)
          }
          this.repo.update(match.id, {
            name: profile.name,
            config: buildConfigFromExport(profile),
          })
          result.imported += 1
          continue
        }

        // 新建：创建 keystoreRef，apiKey 写入 Keychain
        const newId = crypto.randomUUID()
        const providerType = profile.provider
        const ref = keystore.makeKeystoreRef(providerType, newId)
        if (profile.apiKey) {
          await keystore.setSecret(ref, profile.apiKey)
          log.info(`Imported provider with API key for id=${newId} name=${profile.name}`)
        } else {
          // 无 apiKey：不写入 keychain（keytar 不接受空密码），
          // 用户需要在编辑面板补 Key 才能 healthCheck
          log.info(`Imported provider without API key for id=${newId} name=${profile.name}`)
        }

        this.repo.create({
          id: newId,
          providerType,
          name: profile.name,
          config: buildConfigFromExport(profile),
          keystoreRef: ref,
          // 导入时强制非默认，避免覆盖本地默认设置
          isDefault: false,
        })
        result.imported += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        result.errors.push(`[${profile.name}] ${message}`)
        log.warn(`Failed to import provider "${profile.name}": ${message}`)
      }
    }

    return result
  }
}

function fetchAnthropicMessagesPing(
  apiEndpoint: string | undefined,
  apiKey: string,
  model: string,
): Promise<Response> {
  return fetch(getAnthropicMessagesEndpoint(apiEndpoint), {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
    signal: AbortSignal.timeout(PROVIDER_CONNECTION_TIMEOUT_MS),
  })
}

function fetchOpenAiCompatiblePing(
  apiEndpoint: string,
  apiKey: string,
  model: string,
  codexApiKind: 'chat' | 'responses' | 'embedding',
): Promise<Response> {
  // embedding 模型（如智谱 embedding-3、OpenAI text-embedding-3）不支持 chat/responses，
  // 必须用 /embeddings 端点 ping，否则会被服务端拒绝为 4xx，导致健康检查误判为不健康。
  if (codexApiKind === 'embedding') {
    return fetch(getOpenAiEmbeddingsEndpoint(apiEndpoint), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, input: 'ping' }),
      signal: AbortSignal.timeout(PROVIDER_CONNECTION_TIMEOUT_MS),
    })
  }
  const endpoint =
    codexApiKind === 'responses'
      ? getOpenAiResponsesEndpoint(apiEndpoint)
      : getOpenAiChatCompletionsEndpoint(apiEndpoint)
  const body =
    codexApiKind === 'responses'
      ? {
          model,
          input: 'ping',
          max_output_tokens: 1,
          stream: false,
        }
      : {
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }

  return fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PROVIDER_CONNECTION_TIMEOUT_MS),
  })
}

function formatProviderConnectionError(err: unknown, timeoutMs: number): string {
  const fallback = String(err)
  if (!(err instanceof Error)) return fallback
  const normalized = `${err.name}: ${err.message}`.toLowerCase()
  if (
    err.name === 'TimeoutError' ||
    normalized.includes('timed out') ||
    normalized.includes('aborted due to timeout')
  ) {
    return `连接测试超时（>${Math.ceil(timeoutMs / 1000)}s），请检查网络、代理或接口地址后重试`
  }
  return err.message || fallback
}

interface ProviderConfig {
  defaultModel?: string
  model?: string
  modelIds?: string[]
  availableModelIds?: string[]
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses' | 'embedding'
  supportsMillionContext?: boolean
  /** 自定义上下文窗口（tokens），优先级高于 supportsMillionContext。 */
  contextWindow?: number
  maxTokens?: number
  temperature?: number
  /** 档位映射；未配置则回落 defaultModel */
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  modelType?: ProviderModelType
  imageProvider?: string | null
  imageApiType?: ImageGenApiType | null
  /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
  mediaProvider?: MediaProviderKind | null
  /** 多媒体调用方式 */
  mediaApiType?: MediaApiType | null
  /** 已声明支持的多媒体能力列表 */
  mediaCapabilities?: MediaCapabilityId[]
  /** 多媒体能力默认值 */
  mediaDefaults?: ProviderMediaDefaults
  /** 启用的多媒体模型 manifest 引用 */
  mediaModelRefs?: ProviderMediaModelRef[]
  /** Provider 列表和模型配置表单里展示的 LobeHub 图标配置。 */
  providerIcon?: { id?: unknown; style?: unknown }
  managed?: boolean
  managedType?: 'newapi'
  managedOwnerUserId?: string
  credentialState?: 'ready' | 'session_conflict' | 'quota_exhausted' | 'unavailable'
}

function isManagedProviderRow(row: { config_json: string }): boolean {
  try {
    return (JSON.parse(row.config_json) as ProviderConfig).managed === true
  } catch {
    return false
  }
}

interface ModelsListResponse {
  data?: Array<{
    id?: unknown
    owned_by?: unknown
    ownedBy?: unknown
  }>
}

function normalizeProviderType(providerType: string): TextProviderKind {
  return TEXT_PROVIDER_KINDS.has(providerType as TextProviderKind)
    ? (providerType as TextProviderKind)
    : 'openai'
}

function normalizeModelIds(defaultModel: string, modelIds?: string[]): string[] {
  const normalized = [defaultModel, ...(modelIds ?? [])]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return [...new Set(normalized)]
}

function normalizeProviderIcon(
  icon: ProviderConfig['providerIcon'],
): ProviderIconConfig | undefined {
  if (icon == null || typeof icon !== 'object') return undefined
  const id = typeof icon.id === 'string' ? icon.id.trim().toLowerCase() : ''
  if (!id) return undefined
  const style = icon.style === 'mono' ? icon.style : 'avatar'
  return { id, style }
}

type NormalizedProviderConfig = Required<Pick<ProviderConfig, 'defaultModel' | 'modelIds'>> &
  Omit<ProviderConfig, 'defaultModel' | 'modelIds' | 'providerIcon'> & {
    providerIcon?: ProviderIconConfig
  }

/**
 * 把 imageProvider 字符串归一到 mediaProvider 枚举：
 *   openai / openai-compatible → 'openai-compatible'
 *   apimart / xai / custom     → 原值
 *   其它（gemini / seeddance / bailian / zhipu / openrouter …）→ 'custom' 兜底
 */
function mediaProviderFromImageProvider(imageProvider: string): MediaProviderKind {
  const v = imageProvider.trim().toLowerCase()
  if (isMediaProviderKind(v)) return v
  if (v === 'apimart') return 'apimart'
  if (v === 'xai') return 'xai'
  if (v === 'bailian') return 'bailian'
  if (v === 'seeddance' || v === 'seedance' || v === 'volcengine') return 'volcengine-ark'
  if (v === 'custom') return 'custom'
  if (v === 'openai' || v === 'openai-compatible') return 'openai-compatible'
  if (v === 'gemini' || v === 'google') return 'google-generative-ai'
  return 'custom'
}

function normalizeMediaCapabilities(
  capabilities: MediaCapabilityId[] | undefined,
  modelType: ProviderModelType | undefined,
): MediaCapabilityId[] | undefined {
  const normalized = Array.from(new Set((capabilities ?? []).filter(isMediaCapabilityId)))
  if (normalized.length > 0) return normalized
  // 兜底：未显式声明时按 modelType 推默认能力
  if (modelType === 'image') return ['image.generate']
  if (modelType === 'voice') return ['audio.speech']
  if (modelType === 'video') return ['video.generate']
  return undefined
}

function normalizeProviderConfig(config: ProviderConfig): NormalizedProviderConfig {
  const defaultModel = (config.defaultModel ?? config.model ?? '').trim()
  const modelType =
    config.modelType !== undefined ? normalizeModelType(config.modelType) : undefined
  const providerIcon = normalizeProviderIcon(config.providerIcon)
  const { providerIcon: _rawProviderIcon, ...configWithoutProviderIcon } = config
  const imageProvider = modelType === 'image' ? config.imageProvider?.trim() || 'openai' : undefined
  const imageApiType =
    modelType === 'image' ? normalizeImageApiType(config.imageApiType) : undefined
  const normalized: NormalizedProviderConfig = {
    ...configWithoutProviderIcon,
    defaultModel,
    modelIds: normalizeModelIds(defaultModel, config.modelIds),
  }
  if (modelType !== undefined) normalized.modelType = modelType
  if (imageProvider !== undefined) normalized.imageProvider = imageProvider
  else delete normalized.imageProvider
  if (imageApiType !== undefined) normalized.imageApiType = imageApiType
  else delete normalized.imageApiType
  if (providerIcon !== undefined) normalized.providerIcon = providerIcon
  else delete normalized.providerIcon

  // ── 多媒体能力归一化 ──
  // modelType=image 时，把 imageProvider/imageApiType 同步到 mediaProvider/mediaApiType，
  // 并保证 mediaCapabilities 至少包含 image.generate（design doc §5.1 兼容规则）。
  if (modelType === 'image') {
    const inferredProvider = mediaProviderFromImageProvider(
      config.mediaProvider ?? config.imageProvider ?? 'openai',
    )
    const inferredApiType =
      config.mediaApiType != null && isMediaApiType(config.mediaApiType)
        ? config.mediaApiType
        : (normalizeImageApiType(config.imageApiType) as MediaApiType)
    normalized.mediaProvider = inferredProvider
    normalized.mediaApiType = inferredApiType
    const caps = normalizeMediaCapabilities(config.mediaCapabilities, 'image') ?? ['image.generate']
    if (!caps.includes('image.generate')) caps.push('image.generate')
    normalized.mediaCapabilities = caps
  } else {
    // 非 image：保留显式声明的 mediaProvider / mediaApiType / mediaCapabilities
    if (config.mediaProvider != null && isMediaProviderKind(config.mediaProvider)) {
      normalized.mediaProvider = config.mediaProvider
    } else if (config.mediaProvider === null) {
      normalized.mediaProvider = null
    } else {
      delete normalized.mediaProvider
    }
    if (config.mediaApiType != null && isMediaApiType(config.mediaApiType)) {
      normalized.mediaApiType = config.mediaApiType
    } else if (config.mediaApiType === null) {
      normalized.mediaApiType = null
    } else {
      delete normalized.mediaApiType
    }
    const inferredCaps = normalizeMediaCapabilities(config.mediaCapabilities, modelType)
    if (inferredCaps != null) normalized.mediaCapabilities = inferredCaps
    else delete normalized.mediaCapabilities
  }
  if (config.mediaDefaults != null) {
    normalized.mediaDefaults = config.mediaDefaults
  } else {
    delete normalized.mediaDefaults
  }
  if (Array.isArray(config.mediaModelRefs)) {
    normalized.mediaModelRefs = config.mediaModelRefs
      .filter(
        (ref) =>
          ref != null && typeof ref.manifestId === 'string' && ref.manifestId.trim().length > 0,
      )
      .map((ref) => {
        const normalizedRef: ProviderMediaModelRef = {
          manifestId: ref.manifestId.trim(),
          ...(ref.modelId != null && ref.modelId.trim().length > 0
            ? { modelId: ref.modelId.trim() }
            : {}),
          ...(ref.enabled !== undefined ? { enabled: ref.enabled } : {}),
          ...(ref.defaults !== undefined ? { defaults: ref.defaults } : {}),
          ...(ref.manifest !== undefined ? { manifest: ref.manifest } : {}),
        }
        return ProviderMediaModelRefSchema.parse(normalizedRef)
      })
  } else {
    delete normalized.mediaModelRefs
  }

  return normalized
}

function normalizeProviderConfigForProviderType(
  providerType: string,
  config: ProviderConfig,
): NormalizedProviderConfig {
  const normalized = normalizeProviderConfig(config)
  const codexApiKind = resolveProviderCodexApiKind(providerType, normalized)
  if (codexApiKind !== undefined) normalized.codexApiKind = codexApiKind
  return normalized
}

function resolveProviderCodexApiKind(
  providerType: string,
  config: Pick<ProviderConfig, 'apiEndpoint' | 'codexApiKind'>,
): 'chat' | 'responses' | 'embedding' | undefined {
  if (normalizeProviderType(providerType) !== 'openai') return undefined
  if (shouldDefaultOpenAiCodexResponses(config.apiEndpoint)) return 'responses'
  return config.codexApiKind
}

function shouldDefaultOpenAiCodexResponses(apiEndpoint?: string): boolean {
  const base = apiEndpoint?.trim().replace(/\/+$/, '').toLowerCase()
  if (!base) return false
  if (base.endsWith('/api/coding')) return true
  return (
    base === 'https://open.bigmodel.cn/api/coding/paas/v4' ||
    base === 'https://coding.dashscope.aliyuncs.com/v1' ||
    base === 'https://api.lkeap.cloud.tencent.com/coding/v3'
  )
}

function normalizeLocalCliProviderConfig(
  providerId: string,
  config: ProviderConfig,
): NormalizedProviderConfig {
  if (providerId === LOCAL_CODEX_CLI_PROVIDER_ID) {
    return normalizeProviderConfig({
      ...config,
      defaultModel: LOCAL_CODEX_CLI_DEFAULT_MODEL,
      modelIds: [LOCAL_CODEX_CLI_DEFAULT_MODEL],
      codexApiKind: 'responses',
    })
  }
  return normalizeProviderConfig({
    ...config,
    defaultModel: LOCAL_CLI_DEFAULT_MODEL,
    modelIds: [LOCAL_CLI_DEFAULT_MODEL],
  })
}

function normalizeModelType(value: unknown): ProviderModelType {
  return typeof value === 'string' && PROVIDER_MODEL_TYPES.has(value as ProviderModelType)
    ? (value as ProviderModelType)
    : 'multimodal'
}

function normalizeImageApiType(value: unknown): ImageGenApiType {
  return typeof value === 'string' && IMAGE_API_TYPES.has(value as ImageGenApiType)
    ? (value as ImageGenApiType)
    : 'sync'
}

function getDefaultEndpointBase(providerType: string): string {
  switch (providerType) {
    case 'anthropic':
      return 'https://api.anthropic.com'
    case 'openai':
      return 'https://api.openai.com/v1'
    default:
      return 'https://api.openai.com/v1'
  }
}

function getAnthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = (apiEndpoint ?? 'https://api.anthropic.com').replace(/\/+$/, '')
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

function getOpenAiChatCompletionsEndpoint(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (endsWithVersionSegment(base)) return `${base}/chat/completions`
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function getOpenAiResponsesEndpoint(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/chat/completions'))
    return `${base.slice(0, -'/chat/completions'.length)}/responses`
  if (endsWithVersionSegment(base)) return `${base}/responses`
  if (base.endsWith('/v1')) return `${base}/responses`
  return `${base}/v1/responses`
}

function getOpenAiEmbeddingsEndpoint(apiEndpoint: string): string {
  const base = apiEndpoint.replace(/\/+$/, '')
  if (base.endsWith('/embeddings')) return base
  if (base.endsWith('/chat/completions'))
    return `${base.slice(0, -'/chat/completions'.length)}/embeddings`
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/embeddings`
  if (endsWithVersionSegment(base)) return `${base}/embeddings`
  if (base.endsWith('/v1')) return `${base}/embeddings`
  return `${base}/v1/embeddings`
}

const KNOWN_MODELS_COMPAT_SUFFIXES = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
] as const

function getModelsUrlCandidates(
  baseUrl: string,
  isFullUrl: boolean,
  modelsUrlOverride: string | null | undefined,
): string[] {
  const override = modelsUrlOverride?.trim()
  if (override) return [override]

  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return []

  const candidates: string[] = []
  if (isFullUrl) {
    const v1Index = trimmed.indexOf('/v1/')
    if (v1Index >= 0) candidates.push(`${trimmed.slice(0, v1Index)}/v1/models`)
    const lastSlash = trimmed.lastIndexOf('/')
    if (lastSlash > trimmed.indexOf('://') + 2)
      candidates.push(`${trimmed.slice(0, lastSlash)}/models`)
    return uniqStrings(candidates)
  }

  const stripped = stripKnownCompatSuffix(trimmed)

  if (endsWithVersionSegment(trimmed)) {
    candidates.push(`${trimmed}/models`)
    if (!trimmed.endsWith('/v1')) candidates.push(`${trimmed}/v1/models`)
  } else {
    candidates.push(`${trimmed}/v1/models`)
    if (stripped == null) candidates.push(`${trimmed}/models`)
  }

  if (stripped != null) {
    const root = stripped.replace(/\/+$/, '')
    if (root.includes('://')) {
      candidates.push(`${root}/v1/models`)
      candidates.push(`${root}/models`)
    }
  }

  return uniqStrings(candidates)
}

function getModelsRequestHeaders(providerType: string, apiKey: string): Record<string, string> {
  if (providerType === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  return { Authorization: `Bearer ${apiKey}` }
}

function normalizeFetchedModels(response: ModelsListResponse): ProviderFetchedModel[] {
  return (response.data ?? [])
    .flatMap((item): ProviderFetchedModel[] => {
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (!id) return []
      const ownedBy =
        typeof item.owned_by === 'string'
          ? item.owned_by
          : typeof item.ownedBy === 'string'
            ? item.ownedBy
            : null
      return [{ id, ownedBy }]
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function truncateResponseBody(body: string): string {
  return body.length > MODELS_ERROR_BODY_MAX_CHARS
    ? `${body.slice(0, MODELS_ERROR_BODY_MAX_CHARS)}...`
    : body
}

function endsWithVersionSegment(value: string): boolean {
  const last = value.split('/').pop() ?? ''
  return /^v\d+$/i.test(last)
}

function stripKnownCompatSuffix(value: string): string | null {
  for (const suffix of KNOWN_MODELS_COMPAT_SUFFIXES) {
    if (value.endsWith(suffix)) return value.slice(0, -suffix.length)
  }
  return null
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

/* ─── 导入导出辅助 ─────────────────────────────────────────────────────────── */

/**
 * 把数据库行（已含 config_json）转成可导出的 ProviderExportProfile。
 *
 * 故意丢弃：
 *   - keystoreRef（导入时不复用；新建时会生成新 ref）
 *   - createdAt（导入时由 DB 自动生成）
 *
 * apiKey 通过参数传入（从 Keychain 读取），非空时附带到导出数据中。
 */
function rowToExportProfile(
  row: {
    id: string
    provider_type: string
    name: string
    config_json: string
    is_default: number
  },
  apiKey?: string,
): ProviderExportProfile {
  const config = normalizeProviderConfigForProviderType(
    row.provider_type,
    JSON.parse(row.config_json) as ProviderConfig,
  )
  return {
    id: row.id,
    name: row.name,
    provider: normalizeProviderType(row.provider_type),
    apiEndpoint: config.apiEndpoint ?? null,
    defaultModel: config.defaultModel,
    modelIds: config.modelIds,
    ...(config.providerIcon !== undefined && { providerIcon: config.providerIcon }),
    supportsMillionContext: config.supportsMillionContext === true,
    ...(typeof config.contextWindow === 'number' &&
      config.contextWindow > 0 && { contextWindow: config.contextWindow }),
    ...(typeof config.maxTokens === 'number' &&
      config.maxTokens > 0 && { maxTokens: config.maxTokens }),
    isDefault: row.is_default === 1,
    ...(config.haikuModel !== undefined && { haikuModel: config.haikuModel }),
    ...(config.sonnetModel !== undefined && { sonnetModel: config.sonnetModel }),
    ...(config.opusModel !== undefined && { opusModel: config.opusModel }),
    ...(config.codexApiKind !== undefined && { codexApiKind: config.codexApiKind }),
    modelType: normalizeModelType(config.modelType),
    ...(config.imageProvider !== undefined && { imageProvider: config.imageProvider }),
    ...(config.imageApiType !== undefined && { imageApiType: config.imageApiType }),
    ...(config.mediaProvider !== undefined && { mediaProvider: config.mediaProvider }),
    ...(config.mediaApiType !== undefined && { mediaApiType: config.mediaApiType }),
    ...(config.mediaCapabilities !== undefined && { mediaCapabilities: config.mediaCapabilities }),
    ...(config.mediaDefaults !== undefined && { mediaDefaults: config.mediaDefaults }),
    ...(config.mediaModelRefs !== undefined && { mediaModelRefs: config.mediaModelRefs }),
    ...(apiKey && apiKey.length > 0 && { apiKey }),
  }
}

/**
 * 从 ProviderExportProfile 重建可写入 config_json 的对象。
 *
 * 字段默认值：import 时 apiEndpoint 是 null 表示"使用默认"，
 * 此时不写入 apiEndpoint 键（保持与 rowToProfile 行为一致）。
 */
function buildConfigFromExport(profile: ProviderExportProfile): {
  defaultModel: string
  modelIds: string[]
  providerIcon?: ProviderIconConfig
  apiEndpoint?: string
  codexApiKind?: 'chat' | 'responses' | 'embedding'
  supportsMillionContext?: boolean
  contextWindow?: number
  maxTokens?: number
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
  modelType?: ProviderModelType
  imageProvider?: string | null
  imageApiType?: ImageGenApiType | null
  mediaProvider?: MediaProviderKind | null
  mediaApiType?: MediaApiType | null
  mediaCapabilities?: MediaCapabilityId[]
  mediaDefaults?: ProviderMediaDefaults
  mediaModelRefs?: ProviderMediaModelRef[]
} {
  return {
    defaultModel: profile.defaultModel,
    modelIds: profile.modelIds,
    ...(profile.providerIcon !== undefined && { providerIcon: profile.providerIcon }),
    ...(profile.apiEndpoint != null && { apiEndpoint: profile.apiEndpoint }),
    ...(profile.codexApiKind !== undefined && { codexApiKind: profile.codexApiKind }),
    supportsMillionContext: profile.supportsMillionContext,
    ...(typeof profile.contextWindow === 'number' &&
      profile.contextWindow > 0 && { contextWindow: profile.contextWindow }),
    ...(typeof profile.maxTokens === 'number' &&
      profile.maxTokens > 0 && { maxTokens: profile.maxTokens }),
    ...(profile.haikuModel != null &&
      profile.haikuModel.length > 0 && { haikuModel: profile.haikuModel }),
    ...(profile.sonnetModel != null &&
      profile.sonnetModel.length > 0 && { sonnetModel: profile.sonnetModel }),
    ...(profile.opusModel != null &&
      profile.opusModel.length > 0 && { opusModel: profile.opusModel }),
    ...(profile.modelType !== undefined && { modelType: profile.modelType }),
    ...(profile.imageProvider !== undefined && { imageProvider: profile.imageProvider }),
    ...(profile.imageApiType !== undefined && { imageApiType: profile.imageApiType }),
    ...(profile.mediaProvider !== undefined && { mediaProvider: profile.mediaProvider }),
    ...(profile.mediaApiType !== undefined && { mediaApiType: profile.mediaApiType }),
    ...(profile.mediaCapabilities !== undefined && {
      mediaCapabilities: profile.mediaCapabilities,
    }),
    ...(profile.mediaDefaults !== undefined && { mediaDefaults: profile.mediaDefaults }),
    ...(profile.mediaModelRefs !== undefined && { mediaModelRefs: profile.mediaModelRefs }),
  }
}
