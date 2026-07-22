import type { CanvasSnapshot } from './canvas.types'

const NESTED_PATH_KEYS = new Set([
  'path',
  'filePath',
  'sourcePath',
  'outputPath',
  'outputUrl',
  'inputPath',
  'thumbnailPath',
  'previewUrl',
])

export function sanitizeLegacyCanvasProjectImport(snapshot: CanvasSnapshot): {
  snapshot: CanvasSnapshot
  warnings: string[]
} {
  const next = JSON.parse(JSON.stringify(snapshot)) as CanvasSnapshot
  const warnings: string[] = []
  next.project.rootPath = null

  if (isNonPortableReference(next.project.coverUrl)) {
    next.project.coverUrl = null
    warnings.push('旧 JSON 项目封面引用本机文件，已跳过。')
  }

  for (const asset of next.assets) {
    let stripped = false
    if (isNonPortableReference(asset.storageKey)) {
      asset.storageKey = null
      stripped = true
    }
    if (isNonPortableReference(asset.url)) {
      asset.url = null
      stripped = true
    }
    if (isNonPortableReference(asset.thumbnailKey)) {
      asset.thumbnailKey = null
      stripped = true
    }
    if (isNonPortableReference(asset.thumbnailUrl)) {
      asset.thumbnailUrl = null
      stripped = true
    }
    if (stripNestedLocalPaths(asset.metadata)) stripped = true
    if (stripped) {
      warnings.push(
        `旧 JSON 资产“${asset.title?.trim() || asset.id}”包含不可移植的本机文件引用，已跳过。`,
      )
    }
  }

  for (const node of next.nodes) {
    let stripped = false
    if (isNonPortableReference(node.data.url)) {
      delete node.data.url
      stripped = true
    }
    if (isNonPortableReference(node.data.thumbnailUrl)) {
      delete node.data.thumbnailUrl
      stripped = true
    }
    if (stripNestedLocalPaths(node.data)) stripped = true
    if (stripped && !node.assetId) {
      warnings.push(
        `旧 JSON 节点“${node.title?.trim() || node.id}”包含不可移植的本机文件引用，已跳过。`,
      )
    }
  }

  if (warnings.length > 0) {
    const existingWarnings = Array.isArray(next.project.metadata?.['importWarnings'])
      ? next.project.metadata['importWarnings'].filter(
          (warning): warning is string => typeof warning === 'string',
        )
      : []
    next.project.metadata = {
      ...(next.project.metadata ?? {}),
      importWarnings: [...existingWarnings, ...warnings],
    }
  }
  return { snapshot: next, warnings }
}

function isNonPortableReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  return !/^(?:data|https?):/i.test(value)
}

function stripNestedLocalPaths(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.reduce<boolean>(
      (stripped, child) => stripNestedLocalPaths(child) || stripped,
      false,
    )
  }
  if (!isRecord(value)) return false

  let stripped = false
  for (const [key, child] of Object.entries(value)) {
    if (NESTED_PATH_KEYS.has(key) && isNonPortableReference(child)) {
      delete value[key]
      stripped = true
      continue
    }
    if (stripNestedLocalPaths(child)) stripped = true
  }
  return stripped
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
