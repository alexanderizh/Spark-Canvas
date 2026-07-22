/**
 * canvas:project:delete 路径安全测试
 *
 * 删除项目时清掉磁盘上的项目文件夹，最大的风险是「路径校验不严导致误删用户其他目录」。
 * 这里只测纯函数 `isPathStrictlyInsideRoot` —— 它是删除前的唯一守卫，
 * 必须覆盖：根目录自身拒绝、根外路径拒绝、跨卷拒绝、合法子目录放行。
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { isPathStrictlyInsideRoot } from '../../services/CanvasProjectPath.js'

const ROOT = path.join(path.parse(process.cwd()).root, 'Spark Canvas', 'canvas-projects')
const OUTSIDE_ROOT = path.join(path.parse(process.cwd()).root, 'Spark Canvas Backup')

describe('isPathStrictlyInsideRoot', () => {
  it('rejects empty / whitespace-only input', () => {
    expect(isPathStrictlyInsideRoot('', ROOT)).toBe(false)
    expect(isPathStrictlyInsideRoot('   ', ROOT)).toBe(false)
    expect(isPathStrictlyInsideRoot(null, ROOT)).toBe(false)
    expect(isPathStrictlyInsideRoot(undefined, ROOT)).toBe(false)
  })

  it('rejects the root directory itself (would delete all projects)', () => {
    expect(isPathStrictlyInsideRoot(ROOT, ROOT)).toBe(false)
    expect(isPathStrictlyInsideRoot(`${ROOT}${path.sep}`, ROOT)).toBe(false)
  })

  it('rejects paths outside the root (parent traversal)', () => {
    expect(isPathStrictlyInsideRoot(path.dirname(ROOT), ROOT)).toBe(false)
    expect(isPathStrictlyInsideRoot(OUTSIDE_ROOT, ROOT)).toBe(false)
  })

  it('rejects paths on another native drive / volume root', () => {
    const otherVolume =
      process.platform === 'win32'
        ? 'Z:\\spark-canvas-test\\project'
        : '/Volumes/spark-canvas-test/project'
    expect(isPathStrictlyInsideRoot(otherVolume, ROOT)).toBe(false)
  })

  it('accepts legitimate project subdirectories', () => {
    expect(isPathStrictlyInsideRoot(path.join(ROOT, 'proj-canvas_project_abc'), ROOT)).toBe(true)
    expect(isPathStrictlyInsideRoot(path.join(ROOT, 'my-proj-canvas_project_xyz'), ROOT)).toBe(true)
  })

  it('rejects sibling directories that share a prefix but are not children', () => {
    // canvas-projects-backup 与 canvas-projects 同级，名字前缀相同但不是子目录
    expect(isPathStrictlyInsideRoot(path.join(`${ROOT}-backup`, 'evil'), ROOT)).toBe(false)
    expect(isPathStrictlyInsideRoot(path.join(`${ROOT}.bak`, 'evil'), ROOT)).toBe(false)
  })

  it('normalizes relative segments inside the root correctly', () => {
    // 子目录里夹杂 '..' 但仍在根下：path.resolve 会归一化，应当放行
    expect(isPathStrictlyInsideRoot(path.join(ROOT, 'a', '..', 'b-canvas_project_x'), ROOT)).toBe(
      true,
    )
  })

  it('works for posix-style roots', () => {
    const rootPosix = '/Users/test/Library/Application Support/Spark Canvas/canvas-projects'
    expect(isPathStrictlyInsideRoot(`${rootPosix}/proj-canvas_project_1`, rootPosix)).toBe(true)
    expect(isPathStrictlyInsideRoot('/etc', rootPosix)).toBe(false)
    expect(isPathStrictlyInsideRoot(rootPosix, rootPosix)).toBe(false)
  })
})
