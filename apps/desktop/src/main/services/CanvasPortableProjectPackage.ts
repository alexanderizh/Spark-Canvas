import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, realpathSync } from 'node:fs'
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { CanvasProjectPackageManifestV3Schema } from '@spark/protocol'

const SNAPSHOT_RELATIVE_PATH = 'snapshots/latest.json'
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const MAX_ASSET_BYTES = 10 * 1024 * 1024 * 1024
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024 * 1024
const MAX_ASSET_COUNT = 10_000

export interface CanvasProjectDirectoryExportInput {
  sourceRootPath: string
  targetRootPath: string
  snapshotJson: string
  exportedAt?: string
}

export interface CanvasProjectDirectoryImportInput {
  sourceRootPath: string
  targetParentPath: string
}

export interface CanvasProjectDirectoryImportResult {
  rootPath: string
  snapshotJson: string
  warnings: string[]
}

interface PortableAssetEntry {
  path: string
  sha256: string
  bytes: number
  mimeType: string
}

interface PortableSnapshotEntry {
  path: string
  sha256: string
  bytes: number
}

interface FileDigest {
  sha256: string
  bytes: number
}

interface LegacyDirectoryPackagePayload {
  kind: 'spark.canvas.project'
  version: 1 | 2
  app?: string
  exportedAt?: string
  projectRootPath?: string
  snapshot: Record<string, unknown>
}

const SNAPSHOT_PATH_KEYS = new Set([
  'url',
  'thumbnailUrl',
  'storageKey',
  'thumbnailKey',
  'path',
  'filePath',
  'sourcePath',
  'outputPath',
  'outputUrl',
  'inputPath',
  'thumbnailPath',
  'previewUrl',
])

const OMIT_LEGACY_VALUE = Symbol('omit-legacy-value')

export async function exportCanvasProjectDirectoryPackage(
  input: CanvasProjectDirectoryExportInput,
): Promise<void> {
  const sourceRootPath = path.resolve(input.sourceRootPath)
  const targetRootPath = path.resolve(input.targetRootPath)
  await assertDirectoryWithoutSymlink(sourceRootPath, 'Canvas project root')
  await assertPathDoesNotExist(targetRootPath)

  const targetParentPath = path.dirname(targetRootPath)
  await mkdir(targetParentPath, { recursive: true })
  const temporaryRootPath = path.join(
    targetParentPath,
    `.${path.basename(targetRootPath)}.${randomUUID()}.tmp`,
  )

  try {
    const parsedSnapshot: unknown = JSON.parse(input.snapshotJson)
    const snapshot = unwrapSnapshot(parsedSnapshot)
    if (!isRecord(snapshot)) throw new Error('Canvas snapshot must be an object')
    const portableSnapshot = rewriteSnapshotForPackage(snapshot, sourceRootPath)
    if (isRecord(portableSnapshot['project'])) portableSnapshot['project']['rootPath'] = null
    assertCanvasSnapshotShape(portableSnapshot)

    const assets = await collectPortableAssets(sourceRootPath)
    const assetPaths = new Set(assets.map((asset) => asset.path))
    assertSnapshotAssetReferences(portableSnapshot, assetPaths)
    assertPortableSnapshotReferences(portableSnapshot, assetPaths)

    const snapshotText = JSON.stringify(portableSnapshot, null, 2)
    const snapshotBytes = Buffer.byteLength(snapshotText)
    const snapshotSha256 = createHash('sha256').update(snapshotText).digest('hex')
    assertPackageSizeLimits(
      { path: SNAPSHOT_RELATIVE_PATH, bytes: snapshotBytes, sha256: snapshotSha256 },
      assets,
    )

    for (const asset of assets) {
      const sourcePath = packagePath(sourceRootPath, asset.path)
      const destinationPath = packagePath(temporaryRootPath, asset.path)
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await copyFile(sourcePath, destinationPath)
      const copiedDigest = await digestFile(destinationPath)
      if (copiedDigest.bytes !== asset.bytes || copiedDigest.sha256 !== asset.sha256) {
        throw new Error(`Canvas project asset changed while exporting: ${asset.path}`)
      }
    }

    const snapshotPath = packagePath(temporaryRootPath, SNAPSHOT_RELATIVE_PATH)
    await mkdir(path.dirname(snapshotPath), { recursive: true })
    await writeFile(snapshotPath, snapshotText, 'utf8')

    const manifest = CanvasProjectPackageManifestV3Schema.parse({
      kind: 'spark.canvas.project',
      version: 3,
      app: 'Spark Canvas',
      formatRevision: 1,
      exportedAt: input.exportedAt ?? new Date().toISOString(),
      snapshot: {
        path: SNAPSHOT_RELATIVE_PATH,
        sha256: snapshotSha256,
        bytes: snapshotBytes,
      },
      assets,
    })
    await writeFile(
      path.join(temporaryRootPath, 'project.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    )
    await rename(temporaryRootPath, targetRootPath)
  } catch (error) {
    await rm(temporaryRootPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function importCanvasProjectDirectoryPackage(
  input: CanvasProjectDirectoryImportInput,
): Promise<CanvasProjectDirectoryImportResult> {
  const sourceRootPath = path.resolve(input.sourceRootPath)
  const targetParentPath = path.resolve(input.targetParentPath)
  await assertDirectoryWithoutSymlink(sourceRootPath, 'Canvas package root')
  await assertImportTargetOutsideSource(sourceRootPath, targetParentPath)
  await mkdir(targetParentPath, { recursive: true })

  await assertPackageRegularFile(sourceRootPath, 'project.json', 'manifest')
  const manifestPath = path.join(sourceRootPath, 'project.json')
  const manifestStats = await lstat(manifestPath)
  if (manifestStats.size > MAX_MANIFEST_BYTES) {
    throw new Error('Canvas package manifest exceeds the size limit')
  }
  const parsedManifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (isLegacyDirectoryPackagePayload(parsedManifest)) {
    return importLegacyCanvasProjectDirectoryPackage(
      sourceRootPath,
      targetParentPath,
      parsedManifest,
    )
  }
  const manifestResult = CanvasProjectPackageManifestV3Schema.safeParse(parsedManifest)
  if (!manifestResult.success) {
    throw new Error(
      `Invalid Spark Canvas v3 project package manifest: ${manifestResult.error.message}`,
    )
  }
  const manifest = manifestResult.data
  const snapshotEntry = readSnapshotEntry(manifest.snapshot)
  const assetEntries = manifest.assets.map(readAssetEntry)
  assertUniqueManifestPaths(snapshotEntry, assetEntries)
  assertAssetPaths(assetEntries)
  assertPackageSizeLimits(snapshotEntry, assetEntries)
  const snapshotText = await readVerifiedPackageText(sourceRootPath, snapshotEntry, 'snapshot')
  for (const asset of assetEntries) await verifyPackageFile(sourceRootPath, asset, 'asset')
  const portableSnapshot = JSON.parse(snapshotText) as unknown
  if (!isRecord(portableSnapshot)) throw new Error('Canvas package snapshot must be an object')
  assertCanvasSnapshotShape(portableSnapshot)
  assertPortableSnapshotReferences(
    portableSnapshot,
    new Set(assetEntries.map((asset) => asset.path)),
  )

  const projectTitle =
    isRecord(portableSnapshot['project']) &&
    typeof portableSnapshot['project']['title'] === 'string'
      ? portableSnapshot['project']['title']
      : 'canvas-project'
  const finalRootPath = path.join(
    targetParentPath,
    `${sanitizePathSegment(projectTitle)}-${randomUUID()}`,
  )
  const temporaryRootPath = path.join(targetParentPath, `.spark-canvas-import-${randomUUID()}.tmp`)

  try {
    for (const asset of assetEntries) {
      const sourcePath = packagePath(sourceRootPath, asset.path)
      await assertPackageRegularFile(sourceRootPath, asset.path, 'asset')
      const destinationPath = packagePath(temporaryRootPath, asset.path)
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await copyFile(sourcePath, destinationPath)
      await verifyFileDigest(destinationPath, asset, 'copied asset')
    }

    const importedSnapshot = rewriteSnapshotAfterImport(
      portableSnapshot,
      new Set(assetEntries.map((asset) => asset.path)),
      finalRootPath,
    )
    if (isRecord(importedSnapshot['project'])) {
      importedSnapshot['project']['rootPath'] = finalRootPath
    }
    const snapshotJson = JSON.stringify(importedSnapshot)
    const prettySnapshotJson = JSON.stringify(importedSnapshot, null, 2)
    const snapshotsPath = path.join(temporaryRootPath, 'snapshots')
    await mkdir(snapshotsPath, { recursive: true })
    await writeFile(path.join(snapshotsPath, 'latest.json'), prettySnapshotJson, 'utf8')
    await writeFile(
      path.join(temporaryRootPath, 'project.json'),
      JSON.stringify(
        {
          kind: 'spark.canvas.project',
          version: 2,
          app: 'spark-canvas',
          exportedAt:
            typeof manifest.exportedAt === 'string'
              ? manifest.exportedAt
              : new Date().toISOString(),
          projectRootPath: finalRootPath,
          snapshot: importedSnapshot,
        },
        null,
        2,
      ),
      'utf8',
    )
    await rename(temporaryRootPath, finalRootPath)
    return { rootPath: finalRootPath, snapshotJson, warnings: [] }
  } catch (error) {
    await rm(temporaryRootPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function importLegacyCanvasProjectDirectoryPackage(
  sourceRootPath: string,
  targetParentPath: string,
  payload: LegacyDirectoryPackagePayload,
): Promise<CanvasProjectDirectoryImportResult> {
  const snapshot = JSON.parse(JSON.stringify(payload.snapshot)) as Record<string, unknown>
  assertCanvasSnapshotShape(snapshot)
  const project = snapshot['project'] as Record<string, unknown>
  const recordedRoot =
    typeof payload.projectRootPath === 'string'
      ? payload.projectRootPath
      : typeof project['rootPath'] === 'string'
        ? project['rootPath']
        : ''
  if (!isAbsoluteOnAnyPlatform(recordedRoot)) {
    throw new Error('Legacy Canvas package is missing its recorded project root')
  }
  project['rootPath'] = null

  const portableAssets = new Map<string, PortableAssetEntry>()
  let skippedReference = false
  const rewrite = async (
    value: unknown,
    key?: string,
  ): Promise<unknown | typeof OMIT_LEGACY_VALUE> => {
    if (typeof value === 'string' && key && SNAPSHOT_PATH_KEYS.has(key)) {
      if (/^(?:data|https?):/i.test(value)) return value
      const relativePath = legacyPackageRelativePath(value, recordedRoot)
      if (!relativePath) {
        skippedReference = true
        return OMIT_LEGACY_VALUE
      }
      if (!portableAssets.has(relativePath)) {
        try {
          await assertPackageRegularFile(sourceRootPath, relativePath, 'legacy asset')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            skippedReference = true
            return OMIT_LEGACY_VALUE
          }
          throw error
        }
        const filePath = packagePath(sourceRootPath, relativePath)
        const stats = await lstat(filePath)
        if (stats.size > MAX_ASSET_BYTES) {
          throw new Error(`Canvas package asset exceeds the size limit: ${relativePath}`)
        }
        portableAssets.set(relativePath, {
          path: relativePath,
          ...(await digestFile(filePath)),
          mimeType: mimeTypeFromPath(relativePath),
        })
      }
      return relativePath
    }
    if (Array.isArray(value)) {
      const rewrittenItems = await Promise.all(value.map((item) => rewrite(item)))
      return rewrittenItems.filter((item) => item !== OMIT_LEGACY_VALUE)
    }
    if (!isRecord(value)) return value
    const rewritten: Record<string, unknown> = {}
    for (const [childKey, child] of Object.entries(value)) {
      const next = await rewrite(child, childKey)
      if (next !== OMIT_LEGACY_VALUE) rewritten[childKey] = next
    }
    return rewritten
  }

  const portableSnapshot = await rewrite(snapshot)
  if (!isRecord(portableSnapshot)) throw new Error('Legacy Canvas package snapshot is invalid')
  const portableProject = portableSnapshot['project'] as Record<string, unknown>
  portableProject['rootPath'] = null
  for (const asset of portableSnapshot['assets'] as Array<Record<string, unknown>>) {
    for (const field of ['storageKey', 'url', 'thumbnailKey', 'thumbnailUrl']) {
      if (!Object.hasOwn(asset, field)) asset[field] = null
    }
  }

  const assetEntries = [...portableAssets.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  assertPackageSizeLimits(
    {
      path: SNAPSHOT_RELATIVE_PATH,
      bytes: Buffer.byteLength(JSON.stringify(portableSnapshot)),
      sha256: '0'.repeat(64),
    },
    assetEntries,
  )

  const projectTitle =
    typeof portableProject['title'] === 'string' ? portableProject['title'] : 'canvas-project'
  const finalRootPath = path.join(
    targetParentPath,
    `${sanitizePathSegment(projectTitle)}-${randomUUID()}`,
  )
  const temporaryRootPath = path.join(targetParentPath, `.spark-canvas-import-${randomUUID()}.tmp`)

  try {
    for (const asset of assetEntries) {
      const sourcePath = packagePath(sourceRootPath, asset.path)
      const destinationPath = packagePath(temporaryRootPath, asset.path)
      await mkdir(path.dirname(destinationPath), { recursive: true })
      await copyFile(sourcePath, destinationPath)
      await verifyFileDigest(destinationPath, asset, 'copied legacy asset')
    }

    const importedSnapshot = rewriteSnapshotAfterImport(
      portableSnapshot,
      new Set(assetEntries.map((asset) => asset.path)),
      finalRootPath,
    )
    const importedProject = importedSnapshot['project'] as Record<string, unknown>
    importedProject['rootPath'] = finalRootPath
    const snapshotJson = JSON.stringify(importedSnapshot)
    const prettySnapshotJson = JSON.stringify(importedSnapshot, null, 2)
    const snapshotsPath = path.join(temporaryRootPath, 'snapshots')
    await mkdir(snapshotsPath, { recursive: true })
    await writeFile(path.join(snapshotsPath, 'latest.json'), prettySnapshotJson, 'utf8')
    await writeFile(
      path.join(temporaryRootPath, 'project.json'),
      JSON.stringify(
        {
          kind: 'spark.canvas.project',
          version: 2,
          app: 'spark-canvas',
          exportedAt:
            typeof payload.exportedAt === 'string' ? payload.exportedAt : new Date().toISOString(),
          projectRootPath: finalRootPath,
          snapshot: importedSnapshot,
        },
        null,
        2,
      ),
      'utf8',
    )
    await rename(temporaryRootPath, finalRootPath)
    const warnings = ['旧 v2 目录项目包不含原始 checksum；已在导入时重建文件校验。']
    if (skippedReference) warnings.push('旧 v2 目录项目包含包外或缺失文件引用，已跳过。')
    return { rootPath: finalRootPath, snapshotJson, warnings }
  } catch (error) {
    await rm(temporaryRootPath, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

function isLegacyDirectoryPackagePayload(value: unknown): value is LegacyDirectoryPackagePayload {
  return (
    isRecord(value) &&
    value['kind'] === 'spark.canvas.project' &&
    (value['version'] === 1 || value['version'] === 2) &&
    isRecord(value['snapshot'])
  )
}

function legacyPackageRelativePath(value: string, recordedRoot: string): string | null {
  if (value.startsWith('assets/')) return normalizePackageRelativePath(value)
  const decoded = decodeSafeFileUrl(value)
  const candidate = decoded ?? (isAbsoluteOnAnyPlatform(value) ? value : null)
  if (!candidate) return null

  const useWindowsPaths = path.win32.isAbsolute(recordedRoot) || path.win32.isAbsolute(candidate)
  let relativePath: string
  if (useWindowsPaths) {
    if (!path.win32.isAbsolute(recordedRoot) || !path.win32.isAbsolute(candidate)) return null
    relativePath = path.win32
      .relative(path.win32.resolve(recordedRoot), path.win32.resolve(candidate))
      .replaceAll('\\', '/')
  } else {
    if (!path.posix.isAbsolute(recordedRoot) || !path.posix.isAbsolute(candidate)) return null
    relativePath = path.posix.relative(
      path.posix.resolve(recordedRoot),
      path.posix.resolve(candidate),
    )
  }
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    return null
  }
  const normalized = normalizePackageRelativePath(relativePath)
  return normalized.startsWith('assets/') ? normalized : null
}

function unwrapSnapshot(value: unknown): unknown {
  if (
    isRecord(value) &&
    value['kind'] === 'spark.canvas.project' &&
    Object.hasOwn(value, 'snapshot')
  ) {
    return value['snapshot']
  }
  return value
}

function rewriteSnapshotForPackage(
  value: unknown,
  sourceRootPath: string,
): Record<string, unknown> {
  const rewritten = rewriteValueForPackage(value, sourceRootPath)
  if (!isRecord(rewritten)) throw new Error('Canvas snapshot must be an object')
  return rewritten
}

function rewriteValueForPackage(value: unknown, sourceRootPath: string, key?: string): unknown {
  if (typeof value === 'string') {
    if (!key || (!SNAPSHOT_PATH_KEYS.has(key) && key !== 'rootPath')) return value
    if (key === 'rootPath' && isSameNativePath(value, sourceRootPath)) return null
    if (/^(?:data|https?):/i.test(value)) return value
    const decoded = decodeSafeFileUrl(value)
    if (decoded) return relativeAssetPath(decoded, sourceRootPath)
    if (isAbsoluteOnAnyPlatform(value)) return relativeAssetPath(value, sourceRootPath)
    return value
  }
  if (Array.isArray(value))
    return value.map((child) => rewriteValueForPackage(child, sourceRootPath, key))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([childKey, child]) => [
      childKey,
      rewriteValueForPackage(child, sourceRootPath, childKey),
    ]),
  )
}

function relativeAssetPath(filePath: string, sourceRootPath: string): string {
  const relativePath = path.relative(sourceRootPath, path.resolve(filePath))
  if (!isSafeNativeRelativePath(relativePath)) {
    throw new Error('Canvas project package cannot contain paths outside the project root')
  }
  const portablePath = relativePath.split(path.sep).join(path.posix.sep)
  if (!portablePath.startsWith('assets/')) {
    throw new Error(`Canvas project package reference is not a project asset: ${portablePath}`)
  }
  return normalizePackageRelativePath(portablePath)
}

async function collectPortableAssets(sourceRootPath: string): Promise<PortableAssetEntry[]> {
  const assetsRootPath = path.join(sourceRootPath, 'assets')
  try {
    await access(assetsRootPath)
  } catch {
    return []
  }
  await assertDirectoryWithoutSymlink(assetsRootPath, 'Canvas assets root')

  const relativePaths: string[] = []
  const visit = async (directoryPath: string): Promise<void> => {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`Canvas project assets cannot contain symbolic links: ${entry.name}`)
      }
      if (entry.isDirectory()) {
        await visit(entryPath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`Canvas project assets must be regular files: ${entry.name}`)
      }
      const relativePath = path.relative(sourceRootPath, entryPath).split(path.sep).join('/')
      relativePaths.push(normalizePackageRelativePath(relativePath))
    }
  }
  await visit(assetsRootPath)
  relativePaths.sort((left, right) => left.localeCompare(right))

  return Promise.all(
    relativePaths.map(async (relativePath) => {
      const filePath = packagePath(sourceRootPath, relativePath)
      const stats = await lstat(filePath)
      if (stats.size > MAX_ASSET_BYTES) {
        throw new Error(`Canvas project asset exceeds the size limit: ${relativePath}`)
      }
      const digest = await digestFile(filePath)
      return {
        path: relativePath,
        ...digest,
        mimeType: mimeTypeFromPath(relativePath),
      }
    }),
  )
}

function assertSnapshotAssetReferences(snapshot: unknown, assets: ReadonlySet<string>): void {
  const visit = (value: unknown, key?: string): void => {
    if (
      typeof value === 'string' &&
      key != null &&
      SNAPSHOT_PATH_KEYS.has(key) &&
      value.startsWith('assets/')
    ) {
      const relativePath = normalizePackageRelativePath(value)
      if (!assets.has(relativePath)) {
        throw new Error(`Canvas snapshot references an undeclared asset: ${relativePath}`)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, key))
      return
    }
    if (isRecord(value)) {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey)
    }
  }
  visit(snapshot)
}

function assertPortableSnapshotReferences(snapshot: unknown, assets: ReadonlySet<string>): void {
  const visit = (value: unknown, key?: string): void => {
    if (
      typeof value === 'string' &&
      key != null &&
      (SNAPSHOT_PATH_KEYS.has(key) || key === 'rootPath')
    ) {
      if (value.startsWith('safe-file://')) {
        throw new Error('Canvas v3 snapshot cannot contain safe-file references')
      }
      if (isAbsoluteOnAnyPlatform(value)) {
        throw new Error('Canvas v3 snapshot cannot contain absolute paths')
      }
      if (value.startsWith('assets/')) {
        const relativePath = normalizePackageRelativePath(value)
        if (!assets.has(relativePath)) {
          throw new Error(`Canvas snapshot references an undeclared asset: ${relativePath}`)
        }
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((child) => visit(child, key))
      return
    }
    if (isRecord(value)) {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey)
    }
  }
  visit(snapshot)
}

function assertCanvasSnapshotShape(snapshot: Record<string, unknown>): void {
  const project = snapshot['project']
  const board = snapshot['board']
  const boards = snapshot['boards']
  const hasBoard = isRecord(board) || (Array.isArray(boards) && boards.length > 0)
  if (
    !isRecord(project) ||
    typeof project['id'] !== 'string' ||
    project['id'].length === 0 ||
    typeof project['title'] !== 'string' ||
    !hasBoard
  ) {
    throw new Error('Canvas package snapshot has an invalid project or board')
  }
  for (const field of ['nodes', 'edges', 'assets', 'tasks'] as const) {
    if (!Array.isArray(snapshot[field])) {
      throw new Error(`Canvas package snapshot field must be an array: ${field}`)
    }
  }
}

function rewriteSnapshotAfterImport(
  value: Record<string, unknown>,
  assetPaths: ReadonlySet<string>,
  finalRootPath: string,
): Record<string, unknown> {
  const rewrite = (child: unknown, key?: string): unknown => {
    if (typeof child === 'string' && assetPaths.has(child)) {
      const filePath = packagePath(finalRootPath, child)
      return key === 'url' || key === 'thumbnailUrl' ? toSafeFileUrl(filePath) : filePath
    }
    if (Array.isArray(child)) return child.map((item) => rewrite(item))
    if (!isRecord(child)) return child
    return Object.fromEntries(
      Object.entries(child).map(([childKey, nested]) => [childKey, rewrite(nested, childKey)]),
    )
  }
  const rewritten = rewrite(value)
  if (!isRecord(rewritten)) throw new Error('Canvas package snapshot must be an object')
  return rewritten
}

function normalizePackageRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error(`Invalid Canvas package relative path: ${value}`)
  }
  const normalized = path.posix.normalize(value)
  if (normalized !== value || normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`Invalid Canvas package relative path: ${value}`)
  }
  return normalized
}

async function assertDirectoryWithoutSymlink(directoryPath: string, label: string): Promise<void> {
  const stats = await lstat(directoryPath)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory`)
  }
}

async function assertImportTargetOutsideSource(
  sourceRootPath: string,
  targetParentPath: string,
): Promise<void> {
  const canonicalSource = await realpath(sourceRootPath)
  const canonicalTarget = await canonicalizePathAllowMissing(targetParentPath)
  const relativeTarget = path.relative(canonicalSource, canonicalTarget)
  if (relativeTarget === '' || isSafeNativeRelativePath(relativeTarget)) {
    throw new Error('Canvas import target cannot be inside the source package')
  }
}

async function canonicalizePathAllowMissing(inputPath: string): Promise<string> {
  let cursor = path.resolve(inputPath)
  const missingSegments: string[] = []
  while (true) {
    try {
      await lstat(cursor)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parentPath = path.dirname(cursor)
      if (parentPath === cursor) throw error
      missingSegments.unshift(path.basename(cursor))
      cursor = parentPath
    }
  }
  return path.resolve(await realpath(cursor), ...missingSegments)
}

async function assertPathDoesNotExist(targetPath: string): Promise<void> {
  try {
    await lstat(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error(`Canvas project package target already exists: ${targetPath}`)
}

async function digestFile(filePath: string): Promise<FileDigest> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    hash.update(buffer)
  }
  return { sha256: hash.digest('hex'), bytes }
}

async function verifyPackageFile(
  rootPath: string,
  expected: PortableSnapshotEntry,
  label: string,
): Promise<void> {
  const filePath = packagePath(rootPath, expected.path)
  await assertPackageRegularFile(rootPath, expected.path, label)
  await verifyFileDigest(filePath, expected, label)
}

async function readVerifiedPackageText(
  rootPath: string,
  expected: PortableSnapshotEntry,
  label: string,
): Promise<string> {
  await assertPackageRegularFile(rootPath, expected.path, label)
  const bytes = await readFile(packagePath(rootPath, expected.path))
  const actual = {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  assertDigestMatches(actual, expected, label)
  return bytes.toString('utf8')
}

async function assertPackageRegularFile(
  rootPath: string,
  relativePath: string,
  label: string,
): Promise<void> {
  const normalizedPath = normalizePackageRelativePath(relativePath)
  let cursor = rootPath
  for (const segment of normalizedPath.split('/')) {
    cursor = path.join(cursor, segment)
    const stats = await lstat(cursor)
    if (stats.isSymbolicLink()) {
      throw new Error(`Canvas package ${label} cannot use symbolic links: ${normalizedPath}`)
    }
  }
  const fileStats = await lstat(cursor)
  if (!fileStats.isFile()) {
    throw new Error(`Canvas package ${label} must be a regular file: ${normalizedPath}`)
  }

  const canonicalRoot = await realpath(rootPath)
  const canonicalFile = await realpath(cursor)
  const canonicalRelativePath = path.relative(canonicalRoot, canonicalFile)
  if (!isSafeNativeRelativePath(canonicalRelativePath)) {
    throw new Error(`Canvas package ${label} resolves outside the package root: ${normalizedPath}`)
  }
}

async function verifyFileDigest(
  filePath: string,
  expected: PortableSnapshotEntry,
  label: string,
): Promise<void> {
  const actual = await digestFile(filePath)
  assertDigestMatches(actual, expected, label)
}

function assertDigestMatches(
  actual: FileDigest,
  expected: PortableSnapshotEntry,
  label: string,
): void {
  if (actual.bytes !== expected.bytes) {
    throw new Error(`Canvas package ${label} size mismatch: ${expected.path}`)
  }
  if (actual.sha256 !== expected.sha256) {
    throw new Error(`Canvas package ${label} checksum mismatch: ${expected.path}`)
  }
}

function packagePath(rootPath: string, relativePath: string): string {
  return path.join(rootPath, ...normalizePackageRelativePath(relativePath).split('/'))
}

function isSafeNativeRelativePath(relativePath: string): boolean {
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function isAbsoluteOnAnyPlatform(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value)
}

function isSameNativePath(value: unknown, expectedPath: string): boolean {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return false
  if (path.resolve(value) === path.resolve(expectedPath)) return true
  try {
    return realpathSync.native(value) === realpathSync.native(expectedPath)
  } catch {
    return false
  }
}

function toSafeFileUrl(filePath: string): string {
  const encoded = Buffer.from(filePath, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://local/${encoded}`
}

function decodeSafeFileUrl(url: string): string | null {
  if (!url.startsWith('safe-file://')) return null
  try {
    const encoded = url.slice('safe-file://'.length).split('/').slice(1).join('/')
    if (!encoded) return null
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return isAbsoluteOnAnyPlatform(decoded) ? decoded : null
  } catch {
    return null
  }
}

function mimeTypeFromPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.mp4':
      return 'video/mp4'
    case '.mov':
      return 'video/quicktime'
    case '.webm':
      return 'video/webm'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    default:
      return 'application/octet-stream'
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Canvas package manifest field must be a non-empty string: ${field}`)
  }
  return value
}

function readSnapshotEntry(value: Record<string, unknown>): PortableSnapshotEntry {
  return {
    path: normalizePackageRelativePath(requireString(value['path'], 'snapshot.path')),
    sha256: requireSha256(value['sha256'], 'snapshot.sha256'),
    bytes: requireByteCount(value['bytes'], 'snapshot.bytes'),
  }
}

function readAssetEntry(value: unknown, index: number): PortableAssetEntry {
  if (!isRecord(value)) throw new Error(`Canvas package asset entry is invalid: ${index}`)
  const relativePath = normalizePackageRelativePath(
    requireString(value['path'], `assets[${index}].path`),
  )
  return {
    path: relativePath,
    sha256: requireSha256(value['sha256'], `assets[${index}].sha256`),
    bytes: requireByteCount(value['bytes'], `assets[${index}].bytes`),
    mimeType: requireString(value['mimeType'], `assets[${index}].mimeType`),
  }
}

function assertAssetPaths(assets: readonly PortableAssetEntry[]): void {
  for (const asset of assets) {
    if (!asset.path.startsWith('assets/')) {
      throw new Error(`Canvas package asset path must be under assets/: ${asset.path}`)
    }
  }
}

function assertUniqueManifestPaths(
  snapshot: PortableSnapshotEntry,
  assets: readonly PortableAssetEntry[],
): void {
  const paths = new Map<string, string>([['project.json', 'project.json']])
  for (const relativePath of [snapshot.path, ...assets.map((asset) => asset.path)]) {
    const comparisonKey = relativePath.toLowerCase()
    const existing = paths.get(comparisonKey)
    if (existing) {
      throw new Error(`Canvas package manifest path collision: ${existing} and ${relativePath}`)
    }
    paths.set(comparisonKey, relativePath)
  }
}

function assertPackageSizeLimits(
  snapshot: PortableSnapshotEntry,
  assets: readonly PortableAssetEntry[],
): void {
  if (assets.length > MAX_ASSET_COUNT) {
    throw new Error(`Canvas package exceeds the asset count limit: ${assets.length}`)
  }
  if (snapshot.bytes > MAX_SNAPSHOT_BYTES) {
    throw new Error('Canvas package snapshot exceeds the size limit')
  }
  for (const asset of assets) {
    if (asset.bytes > MAX_ASSET_BYTES) {
      throw new Error(`Canvas package asset exceeds the size limit: ${asset.path}`)
    }
  }
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, snapshot.bytes)
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_PACKAGE_BYTES) {
    throw new Error('Canvas package exceeds the total package limit')
  }
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Canvas package manifest field must be a SHA-256 digest: ${field}`)
  }
  return value
}

function requireByteCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Canvas package manifest field must be a byte count: ${field}`)
  }
  return value
}

function sanitizePathSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (cleaned || 'canvas-project').slice(0, 80)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
