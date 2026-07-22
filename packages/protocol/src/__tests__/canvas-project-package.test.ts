import { describe, expect, it } from 'vitest'
import {
  CanvasProjectImportPackageRequestSchema,
  CanvasProjectPackageManifestV3Schema,
  type IpcRequest,
} from '../index.js'

describe('Canvas project package protocol', () => {
  it('validates the strict v3 manifest shape', () => {
    const manifest = CanvasProjectPackageManifestV3Schema.parse({
      kind: 'spark.canvas.project',
      version: 3,
      app: 'Spark Canvas',
      formatRevision: 1,
      exportedAt: '2026-07-20T06:00:00.000Z',
      snapshot: {
        path: 'snapshots/latest.json',
        sha256: 'a'.repeat(64),
        bytes: 100,
      },
      assets: [
        {
          path: 'assets/videos/clip.mp4',
          sha256: 'b'.repeat(64),
          bytes: 200,
          mimeType: 'video/mp4',
        },
      ],
    })

    expect(manifest.version).toBe(3)
    expect(() =>
      CanvasProjectPackageManifestV3Schema.parse({ ...manifest, formatRevision: 2 }),
    ).toThrow()
    expect(() =>
      CanvasProjectPackageManifestV3Schema.parse({ ...manifest, projectRootPath: '/tmp/project' }),
    ).toThrow()
  })

  it('types and validates the directory import IPC request', () => {
    const request: IpcRequest<'canvas:project:import-package'> = {
      sourceDirectory: '/tmp/package',
      targetParentDirectory: '/tmp/projects',
    }

    expect(CanvasProjectImportPackageRequestSchema.parse(request)).toEqual(request)
    expect(() =>
      CanvasProjectImportPackageRequestSchema.parse({
        ...request,
        projectRootPath: '/tmp/untrusted',
      }),
    ).toThrow()
  })
})
