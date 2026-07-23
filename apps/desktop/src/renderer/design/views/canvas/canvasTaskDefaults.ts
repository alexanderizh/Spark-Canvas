import type { CanvasOperationType } from './canvas.types'

const STORAGE_KEY = 'spark-canvas:task-defaults:v1'

export const CANVAS_TASK_DEFAULT_KINDS = [
  'text',
  'image_understanding',
  'image_generation',
  'video_generation',
] as const

export type CanvasTaskDefaultKind = (typeof CANVAS_TASK_DEFAULT_KINDS)[number]

export type CanvasTaskRuntimeDefault = {
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  agentId?: string
  skillIds: string[]
}

export type CanvasTaskDefaultContext = {
  hasImageInput?: boolean
}

type CanvasTaskDefaultStore = Partial<Record<CanvasTaskDefaultKind, CanvasTaskRuntimeDefault>>

const IMAGE_GENERATION_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
])

const VIDEO_GENERATION_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
])

const TEXT_OPERATIONS = new Set<CanvasOperationType>([
  'text_generate',
  'text_rewrite',
  'prompt_optimize',
])

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function normalizeOptionalId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function normalizeTaskDefault(value: unknown): CanvasTaskRuntimeDefault {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { skillIds: [] }
  const input = value as Record<string, unknown>
  const providerProfileId = normalizeOptionalId(input.providerProfileId)
  const manifestId = normalizeOptionalId(input.manifestId)
  const modelId = normalizeOptionalId(input.modelId)
  return {
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(manifestId ? { manifestId } : {}),
    ...(modelId ? { modelId } : {}),
    // Agent 与 Skills 由 Canvas 运行时固定管理；旧存储值不再进入任务默认配置。
    skillIds: [],
  }
}

function hasRuntimeValue(value: CanvasTaskRuntimeDefault): boolean {
  return Boolean(value.providerProfileId || value.manifestId || value.modelId)
}

function readStore(): CanvasTaskDefaultStore {
  if (!canUseLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const store: CanvasTaskDefaultStore = {}
    for (const kind of CANVAS_TASK_DEFAULT_KINDS) {
      const value = normalizeTaskDefault(parsed[kind])
      if (hasRuntimeValue(value)) store[kind] = value
    }
    return store
  } catch {
    return {}
  }
}

function writeStore(store: CanvasTaskDefaultStore): void {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Local storage can be unavailable in restricted renderers.
  }
}

export function canvasTaskDefaultKindForOperation(
  operation: CanvasOperationType,
  context: CanvasTaskDefaultContext = {},
): CanvasTaskDefaultKind | null {
  if (TEXT_OPERATIONS.has(operation)) {
    return context.hasImageInput ? 'image_understanding' : 'text'
  }
  if (IMAGE_GENERATION_OPERATIONS.has(operation)) return 'image_generation'
  if (VIDEO_GENERATION_OPERATIONS.has(operation)) return 'video_generation'
  return null
}

export function readCanvasTaskDefaults(): CanvasTaskDefaultStore {
  return readStore()
}

export function readCanvasTaskDefault(kind: CanvasTaskDefaultKind): CanvasTaskRuntimeDefault {
  const value = readStore()[kind]
  return value ? { ...value, skillIds: [...value.skillIds] } : { skillIds: [] }
}

export function writeCanvasTaskDefault(
  kind: CanvasTaskDefaultKind,
  value: Partial<CanvasTaskRuntimeDefault>,
): void {
  const store = readStore()
  const normalized = normalizeTaskDefault(value)
  if (hasRuntimeValue(normalized)) {
    store[kind] = normalized
  } else {
    delete store[kind]
  }
  writeStore(store)
}

export function resetCanvasTaskDefault(kind: CanvasTaskDefaultKind): void {
  const store = readStore()
  delete store[kind]
  writeStore(store)
}

export function hasCanvasTaskDefault(kind: CanvasTaskDefaultKind): boolean {
  return hasRuntimeValue(readCanvasTaskDefault(kind))
}
