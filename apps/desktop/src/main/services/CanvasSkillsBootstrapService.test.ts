import { describe, expect, it, vi } from 'vitest'

vi.mock('@spark/agent-runtime', () => ({ SkillService: class {} }))
vi.mock('@spark/storage', () => ({ SkillRepository: class {} }))
vi.mock('../db.js', () => ({ getDatabase: vi.fn() }))
vi.mock('./AppSkillsManager.js', () => ({ getAppSkillsManager: vi.fn() }))

import { bootstrapCanvasSkills, filterCanvasRuntimeSkills } from './CanvasSkillsBootstrapService.js'

describe('Canvas skills bootstrap', () => {
  it('keeps skill:list inside the approved Canvas runtime boundary', () => {
    const skills = filterCanvasRuntimeSkills([
      { id: 'builtin:canvas-studio' },
      { id: 'builtin:multimedia-use' },
      { id: 'builtin:video-workflow' },
      { id: 'builtin:platform-manager' },
      { id: 'builtin:find-skills' },
      { id: 'local:user:future-skill' },
    ])

    expect(skills.map((skill) => skill.id)).toEqual([
      'builtin:canvas-studio',
      'builtin:multimedia-use',
      'builtin:video-workflow',
      'builtin:platform-manager',
    ])
  })

  it('removes only unapproved builtin records from the Canvas database', () => {
    const deleteSkillRecord = vi.fn()

    bootstrapCanvasSkills({
      ensureBuiltInSkills: vi.fn(),
      listSkills: () => [
        {
          id: 'builtin:canvas-studio',
          name: '画布工作室',
          enabled: true,
          rootPath: '/bundled/canvas-studio',
        },
        {
          id: 'builtin:find-skills',
          name: '查找技能',
          enabled: true,
          rootPath: '/bundled/find-skills',
        },
        {
          id: 'local:user:future-skill',
          name: '用户技能',
          enabled: true,
          rootPath: '/user/skills/future-skill',
        },
      ],
      deleteSkillRecord,
      buildManagedPluginDir: vi.fn(),
      managedPluginDir: '/user/skills/_plugin',
      userDir: '/user/skills',
    })

    expect(deleteSkillRecord).toHaveBeenCalledOnce()
    expect(deleteSkillRecord).toHaveBeenCalledWith('builtin:find-skills')
  })

  it('registers bundled skills without importing host Claude or Codex directories', () => {
    const ensureBuiltInSkills = vi.fn()
    const buildManagedPluginDir = vi.fn()
    const autoImportHostSkills = vi.fn()

    const directories = bootstrapCanvasSkills({
      ensureBuiltInSkills,
      listSkills: () => [
        {
          id: 'builtin:canvas-studio',
          name: '画布工作室',
          enabled: true,
          rootPath: '/bundled/canvas-studio',
        },
        {
          id: 'builtin:multimedia-use',
          name: '多媒体使用',
          enabled: true,
          rootPath: '/bundled/multimedia-use',
        },
        {
          id: 'builtin:video-workflow',
          name: '视频工作流',
          enabled: true,
          rootPath: '/bundled/video-workflow',
        },
        {
          id: 'builtin:platform-manager',
          name: '平台管理',
          enabled: true,
          rootPath: '/bundled/platform-manager',
        },
        {
          id: 'builtin:find-skills',
          name: '查找技能',
          enabled: true,
          rootPath: '/bundled/find-skills',
        },
        {
          id: 'builtin:disabled-skill',
          name: '已禁用',
          enabled: false,
          rootPath: '/bundled/disabled',
        },
        {
          id: 'builtin:virtual-skill',
          name: '虚拟技能',
          enabled: true,
          rootPath: 'registry://virtual',
        },
      ],
      deleteSkillRecord: vi.fn(),
      buildManagedPluginDir,
      autoImportHostSkills,
      managedPluginDir: '/user/skills/_plugin',
      userDir: '/user/skills',
    })

    expect(ensureBuiltInSkills).toHaveBeenCalledOnce()
    expect(autoImportHostSkills).not.toHaveBeenCalled()
    expect(buildManagedPluginDir).toHaveBeenCalledWith([
      { name: 'canvas-studio', rootPath: '/bundled/canvas-studio' },
      { name: 'multimedia-use', rootPath: '/bundled/multimedia-use' },
      { name: 'video-workflow', rootPath: '/bundled/video-workflow' },
      { name: 'platform-manager', rootPath: '/bundled/platform-manager' },
    ])
    expect(directories).toEqual({
      managedPluginDir: '/user/skills/_plugin',
      userDir: '/user/skills',
    })
  })
})
