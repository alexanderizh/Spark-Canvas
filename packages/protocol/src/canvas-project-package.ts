import { z } from 'zod'

const CanvasProjectPackageSha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const CanvasProjectPackageRelativePathSchema = z.string().min(1).max(2000)
const CanvasProjectPackageByteCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const CanvasProjectPackageSnapshotEntrySchema = z
  .object({
    path: CanvasProjectPackageRelativePathSchema,
    sha256: CanvasProjectPackageSha256Schema,
    bytes: CanvasProjectPackageByteCountSchema,
  })
  .strict()

export const CanvasProjectPackageAssetEntrySchema = CanvasProjectPackageSnapshotEntrySchema.extend({
  mimeType: z.string().min(1).max(160),
}).strict()

export const CanvasProjectPackageManifestV3Schema = z
  .object({
    kind: z.literal('spark.canvas.project'),
    version: z.literal(3),
    app: z.literal('Spark Canvas'),
    formatRevision: z.literal(1),
    exportedAt: z.string().datetime(),
    snapshot: CanvasProjectPackageSnapshotEntrySchema,
    assets: z.array(CanvasProjectPackageAssetEntrySchema).max(10_000),
  })
  .strict()

export type CanvasProjectPackageManifestV3 = z.infer<typeof CanvasProjectPackageManifestV3Schema>

export const CanvasProjectImportPackageRequestSchema = z
  .object({
    sourceDirectory: z.string().min(1).max(2000),
    targetParentDirectory: z.string().min(1).max(2000).optional(),
  })
  .strict()

export type CanvasProjectImportPackageRequest = z.infer<
  typeof CanvasProjectImportPackageRequestSchema
>

export interface CanvasProjectImportPackageResponse {
  rootPath: string
  snapshotJson: string
  warnings: string[]
}

declare module './ipc/index.js' {
  interface IpcChannelMap {
    'canvas:project:import-package': [
      CanvasProjectImportPackageRequest,
      CanvasProjectImportPackageResponse,
    ]
  }
}
