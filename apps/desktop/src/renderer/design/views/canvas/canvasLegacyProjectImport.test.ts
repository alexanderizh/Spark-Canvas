import { describe, expect, it } from 'vitest'
import { sanitizeLegacyCanvasProjectImport } from './canvasLegacyProjectImport'
import type { CanvasSnapshot } from './canvas.types'

describe('legacy Canvas project import', () => {
  it('strips nested video workbench paths while preserving portable URLs', () => {
    const snapshot = {
      project: {
        id: 'project-1',
        title: 'Legacy film',
        rootPath: '/legacy/project',
        metadata: {},
      },
      board: { id: 'board-1' },
      nodes: [
        {
          id: 'node-1',
          title: 'Workbench',
          assetId: null,
          data: {
            url: 'https://cdn.example.test/source.mp4',
            videoWorkbench: {
              keyframes: [
                {
                  path: '/legacy/project/assets/images/frame.jpg',
                  previewUrl: 'safe-file://local/L2xlZ2FjeS9mcmFtZS5qcGc=',
                },
              ],
              outputs: [
                {
                  outputPath: '/legacy/project/assets/videos/output.mp4',
                  outputUrl: 'safe-file://local/L2xlZ2FjeS9vdXRwdXQubXA0',
                },
              ],
            },
          },
        },
      ],
      edges: [],
      assets: [],
      tasks: [],
    } as unknown as CanvasSnapshot

    const result = sanitizeLegacyCanvasProjectImport(snapshot)
    const workbench = result.snapshot.nodes[0]!.data.videoWorkbench as {
      keyframes: Array<Record<string, unknown>>
      outputs: Array<Record<string, unknown>>
    }

    expect(result.snapshot.nodes[0]!.data.url).toBe('https://cdn.example.test/source.mp4')
    expect(workbench.keyframes[0]).not.toHaveProperty('path')
    expect(workbench.keyframes[0]).not.toHaveProperty('previewUrl')
    expect(workbench.outputs[0]).not.toHaveProperty('outputPath')
    expect(workbench.outputs[0]).not.toHaveProperty('outputUrl')
    expect(result.warnings).toEqual([expect.stringContaining('Workbench')])
  })
})
