import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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

let electronApp: ElectronApplication
let mainWindow: Page
let canvasWindow: Page
let e2eHome: string

test.beforeAll(async () => {
  e2eHome = mkdtempSync(join(tmpdir(), 'spark-canvas-e2e-'))
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
  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  if (!userDataPath.startsWith(e2eHome)) {
    throw new Error(`Electron E2E escaped temporary home: ${userDataPath}`)
  }
})

test.afterAll(async () => {
  if (electronApp) {
    await electronApp.evaluate(({ app }) => app.quit())
    await electronApp.close().catch(() => undefined)
  }
  if (e2eHome) rmSync(e2eHome, { recursive: true, force: true })
})

test('renders the standalone Canvas shell and working primary navigation', async ({}, testInfo) => {
  await expect(mainWindow).toHaveTitle('Spark Canvas')
  await mainWindow.screenshot({ path: testInfo.outputPath('spark-canvas-projects.png') })
  const layout = await mainWindow.evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        display: style.display,
        height: rect.height,
        visibility: style.visibility,
        width: rect.width,
      }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      app: read('.spark-canvas-app'),
      sidebar: read('.spark-canvas-sidebar'),
      navigation: read('.spark-canvas-navigation'),
    }
  })
  expect(layout.sidebar?.height).toBeGreaterThan(700)
  expect(layout.navigation?.height).toBeGreaterThan(150)
  await expect(mainWindow.getByLabel('Spark Canvas 导航')).toBeVisible()
  await expect(mainWindow.locator('.spark-canvas-navigation button')).toHaveCount(4)
  await expect(mainWindow.getByText('画布项目', { exact: true })).toBeVisible()
  await expect(mainWindow.getByText('新建项目', { exact: true })).toBeVisible()
  await expect(mainWindow.getByText('对话', { exact: true })).toHaveCount(0)
  await expect(mainWindow.getByText('工作流', { exact: true })).toHaveCount(0)

  await mainWindow.locator('button[data-view="providers"]').click()
  await expect(mainWindow.locator('button[data-view="providers"]')).toHaveAttribute(
    'aria-current',
    'page',
  )

  await mainWindow.locator('button[data-view="account"]').click()
  await expect(mainWindow.locator('button[data-view="account"]')).toHaveAttribute(
    'aria-current',
    'page',
  )

  await mainWindow.locator('button[data-view="settings"]').click()
  await expect(mainWindow.getByText('视频处理 (FFmpeg)', { exact: true }).first()).toBeVisible()
  await expect(mainWindow.getByText('应用更新', { exact: true })).toBeVisible()
  await mainWindow.screenshot({ path: testInfo.outputPath('spark-canvas-settings.png') })
})

test('creates a project window and loads the Canvas Agent workbench', async ({}, testInfo) => {
  await mainWindow.locator('button[data-view="canvas"]').click()
  await mainWindow.getByRole('button', { name: '创建第一个项目' }).click()
  await mainWindow.getByLabel('项目名称').fill('E2E 视频项目')

  const canvasWindowPromise = electronApp.waitForEvent('window', (page) =>
    page.url().includes('window=canvas'),
  )
  await mainWindow.getByRole('button', { name: '创建并进入画布' }).click()
  canvasWindow = await canvasWindowPromise
  await canvasWindow.waitForLoadState('domcontentloaded')

  await expect(canvasWindow.locator('.canvas-workspace')).toBeVisible()
  await expect(canvasWindow.getByLabel('关闭画布 Agent 助手')).toBeVisible()
  await expect(canvasWindow.getByText('agent 会通过实时画布工具操作项目')).toBeVisible()
  await expect(canvasWindow.getByText('画布助手', { exact: true })).toBeVisible()
  await expect(canvasWindow.getByText('平台管家')).toHaveCount(0)

  const activeProjectId = new URL(canvasWindow.url()).searchParams.get('projectId')
  expect(activeProjectId).toBeTruthy()
  const workspaceBinding = await canvasWindow.evaluate(async (projectId) => {
    const allowed = await window.spark.invoke('canvas:agent:open-workspace', { projectId })
    try {
      await window.spark.invoke('canvas:agent:open-workspace', { projectId: `${projectId}-other` })
      return { allowed, mismatched: { rejected: false, message: '' } }
    } catch (error) {
      return {
        allowed,
        mismatched: {
          rejected: true,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }, activeProjectId!)
  expect(workspaceBinding.allowed.workspaceId).toBeTruthy()
  expect(workspaceBinding.mismatched).toEqual({
    rejected: true,
    message: '当前窗口无权打开该画布项目工作区。',
  })

  const mainWindowResult = await mainWindow.evaluate(async (projectId) => {
    try {
      await window.spark.invoke('canvas:agent:open-workspace', { projectId })
      return { rejected: false, message: '' }
    } catch (error) {
      return {
        rejected: true,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }, activeProjectId!)
  expect(mainWindowResult).toEqual({
    rejected: true,
    message: '当前窗口无权打开该画布项目工作区。',
  })
  await canvasWindow.screenshot({ path: testInfo.outputPath('spark-canvas-workbench.png') })

  await canvasWindow.getByLabel('视频工作台').click()
  await expect(canvasWindow.locator('.vwb-shell')).toBeVisible()
  await expect(canvasWindow.locator('.vwb-modal-overlay')).toHaveCSS('opacity', '1')
  const videoWorkflow = canvasWindow.getByLabel('视频工作流')
  await expect(videoWorkflow).toContainText('01 素材分析')
  await expect(videoWorkflow).toContainText('02 剪辑处理')
  await expect(videoWorkflow).toContainText('03 产物检查')
  await expect(canvasWindow.getByText('关键帧', { exact: true })).toBeVisible()
  await expect(canvasWindow.getByText('剪辑', { exact: true })).toBeVisible()
  await expect(canvasWindow.getByText('产物', { exact: true })).toBeVisible()
  await canvasWindow.screenshot({
    path: testInfo.outputPath('spark-canvas-video-workbench.png'),
  })
  await canvasWindow.getByRole('button', { name: '关闭', exact: true }).click()
  await canvasWindow.getByRole('button', { name: '保存', exact: true }).click()
  await expect(canvasWindow.locator('.canvas-toolbar-savetag')).toHaveText('已保存')
})

test('exports and re-imports a verified v3 directory package', async ({}, testInfo) => {
  const exportParent = join(e2eHome, 'project-package-exports')
  mkdirSync(exportParent, { recursive: true })
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    const showOpenDialog = dialog.showOpenDialog.bind(dialog)
    dialog.showOpenDialog = async (options) => {
      if (options.title === '选择 Canvas 项目包导出位置') {
        return { canceled: false, filePaths: [selectedPath] }
      }
      return showOpenDialog(options)
    }
  }, exportParent)

  await mainWindow.getByLabel('项目操作：E2E 视频项目').click()
  await mainWindow.getByText('导出', { exact: true }).click()
  await expect(mainWindow.getByText('Canvas 项目包已导出', { exact: true })).toBeVisible()
  await expect
    .poll(
      () =>
        readdirSync(exportParent, { withFileTypes: true }).filter((entry) => entry.isDirectory())
          .length,
    )
    .toBe(1)

  const packageDirectory = join(
    exportParent,
    readdirSync(exportParent, { withFileTypes: true }).find((entry) => entry.isDirectory())!.name,
  )
  const manifestPath = join(packageDirectory, 'project.json')
  const manifestBeforeImport = readFileSync(manifestPath, 'utf8')
  const exportedSnapshot = JSON.parse(
    readFileSync(join(packageDirectory, 'snapshots', 'latest.json'), 'utf8'),
  ) as { project: { id: string } }
  expect(JSON.parse(manifestBeforeImport)).toMatchObject({
    kind: 'spark.canvas.project',
    version: 3,
    app: 'Spark Canvas',
    formatRevision: 1,
    snapshot: {
      path: 'snapshots/latest.json',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      bytes: expect.any(Number),
    },
  })

  await electronApp.evaluate(({ dialog }, selectedPath) => {
    const showOpenDialog = dialog.showOpenDialog.bind(dialog)
    dialog.showOpenDialog = async (options) => {
      if (options.title === '选择 Spark Canvas 项目包目录') {
        return { canceled: false, filePaths: [selectedPath] }
      }
      return showOpenDialog(options)
    }
  }, packageDirectory)

  const exportedProjectId = new URL(canvasWindow.url()).searchParams.get('projectId')
  const importedNavigation = canvasWindow.waitForURL((url) => {
    const nextProjectId = url.searchParams.get('projectId')
    return url.searchParams.get('window') === 'canvas' && nextProjectId !== exportedProjectId
  })
  await mainWindow.getByRole('button', { name: '导入项目' }).click()
  await mainWindow.getByText('导入目录项目包', { exact: true }).click()
  await importedNavigation
  await canvasWindow.waitForLoadState('domcontentloaded')

  await expect(canvasWindow.locator('.canvas-workspace')).toBeVisible()
  const importedProject = await canvasWindow.evaluate(async () => {
    const projectId = new URL(window.location.href).searchParams.get('projectId')
    if (!projectId) throw new Error('Imported Canvas window is missing projectId')
    const response = await window.spark.invoke('canvas:snapshot:load', { projectId })
    const snapshot = JSON.parse(response.snapshotJson) as {
      project: { id: string; title: string; rootPath: string | null }
    }
    return snapshot.project
  })
  expect(importedProject.id).not.toBe(exportedSnapshot.project.id)
  expect(importedProject.title).toBe('E2E 视频项目（导入）')
  expect(importedProject.rootPath).toContain(e2eHome)
  expect(readFileSync(manifestPath, 'utf8')).toBe(manifestBeforeImport)
  await expect(mainWindow.locator('.canvas-project-card')).toHaveCount(2)
  await canvasWindow.screenshot({
    path: testInfo.outputPath('spark-canvas-imported-v3-package.png'),
  })
})
