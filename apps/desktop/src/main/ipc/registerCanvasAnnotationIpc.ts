import crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { SparkError } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

export function registerCanvasAnnotationIpc(dependencies: {
  resolveTrustedProjectRoot(sender: unknown): string | null
}): void {
  typedIpcHandle('file:save-canvas-annotation', async (request, event) => {
    const documentJson = request.documentJson.trim()
    if (Buffer.byteLength(documentJson, 'utf8') > 20 * 1024 * 1024) {
      throw new SparkError('VALIDATION_FAILED', '图片标注文档超过 20MB，无法保存')
    }
    try {
      JSON.parse(documentJson)
    } catch {
      throw new SparkError('VALIDATION_FAILED', '图片标注文档不是合法 JSON')
    }

    const trustedProjectRoot = dependencies.resolveTrustedProjectRoot(event.sender)
    if (trustedProjectRoot == null) {
      throw new SparkError('PERMISSION_DENIED', '当前窗口没有可写入的画布项目')
    }
    if (
      request.projectRootPath?.trim() &&
      path.resolve(request.projectRootPath) !== path.resolve(trustedProjectRoot)
    ) {
      throw new SparkError('PERMISSION_DENIED', '标注保存目标与当前画布项目不匹配')
    }

    const canonicalProjectRoot = await fs.realpath(trustedProjectRoot)
    const canonicalAssetsDir = await resolveContainedDirectory(canonicalProjectRoot, 'assets')
    const canonicalAnnotationsDir = await resolveContainedDirectory(
      canonicalAssetsDir,
      'annotations',
    )

    const baseName = (request.suggestedBaseName?.trim() || 'image-annotation').replace(
      /[^a-zA-Z0-9._-]+/g,
      '-',
    )
    const requestedPath = request.existingFilePath?.trim()
    let fileName: string
    if (requestedPath) {
      let requestedParent: string
      try {
        requestedParent = await fs.realpath(path.dirname(path.resolve(requestedPath)))
      } catch {
        throw new SparkError('PERMISSION_DENIED', '标注文件不在当前项目的 annotations 目录内')
      }
      fileName = path.basename(requestedPath)
      if (requestedParent !== canonicalAnnotationsDir) {
        throw new SparkError('PERMISSION_DENIED', '标注文件不在当前项目的 annotations 目录内')
      }
    } else {
      fileName = `${baseName}-${crypto.randomUUID()}.spark-annotation.json`
    }
    if (!fileName.endsWith('.spark-annotation.json')) {
      throw new SparkError('VALIDATION_FAILED', '标注文件扩展名无效')
    }

    const filePath = path.join(canonicalAnnotationsDir, fileName)
    const tempPath = path.join(canonicalAnnotationsDir, `.${fileName}.${crypto.randomUUID()}.tmp`)
    await fs.writeFile(tempPath, documentJson, 'utf8')
    await fs.rename(tempPath, filePath)
    return { filePath, fileName }
  })
}

async function resolveContainedDirectory(parentPath: string, name: string): Promise<string> {
  const expectedPath = path.join(parentPath, name)
  try {
    const existingPath = await fs.realpath(expectedPath)
    if (existingPath !== expectedPath) {
      throw new SparkError('PERMISSION_DENIED', '标注目录不在当前画布项目内')
    }
    return existingPath
  } catch (error) {
    if (error instanceof SparkError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await fs.mkdir(expectedPath)
  const createdPath = await fs.realpath(expectedPath)
  if (createdPath !== expectedPath) {
    throw new SparkError('PERMISSION_DENIED', '标注目录不在当前画布项目内')
  }
  return createdPath
}
