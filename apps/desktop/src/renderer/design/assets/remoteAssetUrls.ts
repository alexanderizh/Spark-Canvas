/** Large Canvas artwork is served from the shared Spark artifact bucket. */
export const DESKTOP_REMOTE_ASSET_BASE_URL =
  'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/assets/desktop'

export function remoteDesktopAssetUrl(relativePath: string): string {
  return `${DESKTOP_REMOTE_ASSET_BASE_URL}/${relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

export function canvasPromptExampleUrl(fileName: string): string {
  return remoteDesktopAssetUrl(`canvas-prompt-examples/${fileName}`)
}

export function canvasGeneratedPromptExampleUrl(fileName: string): string {
  return remoteDesktopAssetUrl(`canvas-prompt-examples/generated/${fileName}`)
}
