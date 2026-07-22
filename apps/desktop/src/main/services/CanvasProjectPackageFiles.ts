import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export {
  exportCanvasProjectDirectoryPackage,
  importCanvasProjectDirectoryPackage,
} from './CanvasPortableProjectPackage.js'

export interface CanvasProjectPackageWriteInput {
  rootPath: string
  snapshotsDir: string
  snapshotJson: string
  exportedAt?: string
}

export async function writeCanvasProjectPackageFiles(
  input: CanvasProjectPackageWriteInput,
): Promise<{ snapshotJson: string }> {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const parsed: unknown = JSON.parse(input.snapshotJson)
  const snapshot = unwrapSnapshot(parsed)
  if (isRecord(snapshot) && isRecord(snapshot['project'])) {
    snapshot['project']['rootPath'] = input.rootPath
  }

  const normalizedSnapshotJson = JSON.stringify(snapshot)
  if (normalizedSnapshotJson === undefined) throw new Error('Canvas snapshot is not serializable')
  const prettySnapshotJson = JSON.stringify(snapshot, null, 2)
  const payload = {
    kind: 'spark.canvas.project',
    version: 2,
    exportedAt,
    app: 'spark-canvas',
    projectRootPath: input.rootPath,
    snapshot,
  }

  await writeTextFileAtomically(
    join(input.rootPath, 'project.json'),
    JSON.stringify(payload, null, 2),
  )
  await writeTextFileAtomically(join(input.snapshotsDir, 'latest.json'), prettySnapshotJson)
  const stamp = exportedAt.replace(/[:.]/g, '-')
  await writeTextFileAtomically(join(input.snapshotsDir, `${stamp}.json`), prettySnapshotJson)
  return { snapshotJson: normalizedSnapshotJson }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function writeTextFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, filePath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
