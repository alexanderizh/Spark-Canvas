import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const DESKTOP_ROOT = join(__dirname, '..')

test.setTimeout(120_000)

let electronApp: ElectronApplication
let mainWindow: Page
let e2eHome: string
let userDataPath: string
let fixtureVideoPath: string

function createVideoFixture(outputPath: string): void {
  execFileSync(
    process.env.SPARK_CANVAS_FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=24:duration=6',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=6',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '24',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      outputPath,
    ],
    { stdio: 'pipe' },
  )
}

function listFilesRecursively(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? listFilesRecursively(path) : [path]
  })
}

test.beforeAll(async () => {
  e2eHome = mkdtempSync(join(tmpdir(), 'spark-canvas-video-e2e-'))
  fixtureVideoPath = join(e2eHome, 'video-workbench-fixture.mp4')
  createVideoFixture(fixtureVideoPath)

  electronApp = await electron.launch({
    args: [DESKTOP_ROOT],
    cwd: DESKTOP_ROOT,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      SPARK_CANVAS_E2E_APP_DATA: e2eHome,
    },
  })
  await electronApp.firstWindow()
  await expect
    .poll(() => electronApp.windows().find((page) => !page.url().startsWith('devtools://')))
    .toBeTruthy()
  mainWindow = electronApp.windows().find((page) => !page.url().startsWith('devtools://'))!
  await mainWindow.waitForLoadState('domcontentloaded')
  userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))

  await electronApp.evaluate(({ dialog }, selectedPath) => {
    const showOpenDialog = dialog.showOpenDialog.bind(dialog)
    dialog.showOpenDialog = async (options) => {
      if (options.title === '选择视频') {
        return { canceled: false, filePaths: [selectedPath] }
      }
      return showOpenDialog(options)
    }
  }, fixtureVideoPath)
  await electronApp.evaluate(({ shell }) => {
    const openedPaths: string[] = []
    ;(globalThis as { __sparkCanvasOpenedPaths?: string[] }).__sparkCanvasOpenedPaths = openedPaths
    shell.openPath = async (path) => {
      openedPaths.push(path)
      return ''
    }
  })
})

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.evaluate(({ app }) => app.quit())
    await electronApp.close().catch(() => undefined)
  }
  if (e2eHome) rmSync(e2eHome, { recursive: true, force: true })
})

test('runs a real video through probe, frames, trim, transcode, segment, and canvas writeback', async ({}, testInfo) => {
  await mainWindow.getByRole('button', { name: '创建第一个项目' }).click()
  await mainWindow.getByLabel('项目名称').fill('真实视频闭环')

  const canvasWindowPromise = electronApp.waitForEvent('window', (page) =>
    page.url().includes('window=canvas'),
  )
  await mainWindow.getByRole('button', { name: '创建并进入画布' }).click()
  const canvasWindow = await canvasWindowPromise
  await canvasWindow.waitForLoadState('domcontentloaded')
  await canvasWindow.getByLabel('视频工作台').click()
  await canvasWindow.getByRole('button', { name: '添加视频' }).click()
  await canvasWindow.getByText('从文件添加…', { exact: true }).click()

  const videoInfo = canvasWindow.locator('.vwb-topbar-info')
  await expect(videoInfo).toContainText('320×180', { timeout: 20_000 })
  await expect(videoInfo).toContainText('00:06')
  await expect(videoInfo).toContainText('24fps')
  await expect(videoInfo).toContainText('h264')

  await canvasWindow.getByText('均匀采样', { exact: true }).click()
  await canvasWindow.getByRole('button', { name: '提取关键帧' }).click()
  await expect.poll(() => canvasWindow.locator('.vwb-frame-card').count()).toBeGreaterThan(0)

  const video = canvasWindow.locator('video.vwb-video')
  await video.evaluate((element) => {
    const player = element as HTMLVideoElement
    player.currentTime = 2
    player.dispatchEvent(new Event('timeupdate', { bubbles: true }))
  })
  await canvasWindow.getByRole('button', { name: /出\s*点/ }).click()
  await canvasWindow.getByRole('button', { name: '精切' }).click()
  await canvasWindow.getByRole('button', { name: '导出选区' }).click()
  await expect(canvasWindow.locator('.vwb-output-item')).toHaveCount(1, { timeout: 20_000 })

  await canvasWindow.getByText('剪辑', { exact: true }).click()
  await canvasWindow.getByRole('button', { name: '转码', exact: true }).click()
  await expect(canvasWindow.locator('.vwb-output-item')).toHaveCount(2, { timeout: 20_000 })

  await canvasWindow.getByText('剪辑', { exact: true }).click()
  const segmentHandle = canvasWindow.locator('.vwb-seg-controls .ant-slider-handle')
  await segmentHandle.focus()
  await segmentHandle.press('Home')
  await expect(segmentHandle).toHaveAttribute('aria-valuenow', '2')
  await canvasWindow.getByRole('button', { name: '分割视频' }).click()
  await expect(canvasWindow.locator('.vwb-output-item')).toHaveCount(5, { timeout: 20_000 })
  await expect(canvasWindow.locator('.vwb-output-item')).toContainText([
    '分割 1/3 · 2s',
    '分割 2/3 · 2s',
    '分割 3/3 · 2s',
    '转码 MP4',
    '轨道裁剪 00:00-00:02',
  ])
  await canvasWindow.locator('.vwb-output-play').first().click()
  await expect
    .poll(() =>
      electronApp.evaluate(
        () =>
          (globalThis as { __sparkCanvasOpenedPaths?: string[] }).__sparkCanvasOpenedPaths
            ?.length ?? 0,
      ),
    )
    .toBe(1)

  await canvasWindow.getByText('关键帧', { exact: true }).click()
  await canvasWindow.getByRole('button', { name: '导入画布' }).click()
  await canvasWindow.getByRole('button', { name: '关闭' }).click()
  const importedFrame = canvasWindow.locator('img.canvas-node-image').first()
  await expect(importedFrame).toBeVisible()
  await expect.poll(() => importedFrame.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0)

  await canvasWindow.getByRole('button', { name: '保存', exact: true }).click()
  await expect(canvasWindow.locator('.canvas-toolbar-savetag')).toHaveText('已保存')
  const projectId = new URL(canvasWindow.url()).searchParams.get('projectId')
  expect(projectId).toBeTruthy()
  const persisted = await canvasWindow.evaluate(async (id) => {
    const response = await window.spark.invoke('canvas:snapshot:load', { projectId: id! })
    const snapshot = JSON.parse(response.snapshotJson) as {
      nodes: Array<{ data?: { subtype?: string; videoWorkbench?: { outputs?: unknown[] } } }>
    }
    const workbench = snapshot.nodes.find((node) => node.data?.subtype === 'video_workbench')
    return workbench?.data?.videoWorkbench?.outputs?.length ?? 0
  }, projectId)
  expect(persisted).toBe(5)

  const artifactRoot = join(userDataPath, '.spark-artifacts', 'media', 'video-workbench')
  const artifactFiles = listFilesRecursively(artifactRoot)
  expect(artifactFiles.filter((path) => path.endsWith('.jpg')).length).toBeGreaterThan(0)
  expect(artifactFiles.filter((path) => path.endsWith('.mp4')).length).toBeGreaterThanOrEqual(5)
  expect(artifactFiles.every((path) => statSync(path).size > 0)).toBe(true)

  await canvasWindow.screenshot({
    path: testInfo.outputPath('spark-canvas-real-video-journey.png'),
  })
})
