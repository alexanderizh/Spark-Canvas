import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SKILLS_ROOT = join(__dirname, '../../../resources/skills')
const MAIN_ROOT = join(__dirname, '..')

describe('bundled Spark Canvas skill copy', () => {
  it('uses the standalone product identity and current settings route', () => {
    const canvas = readFileSync(join(SKILLS_ROOT, 'canvas-studio/SKILL.md'), 'utf8')
    const multimedia = readFileSync(join(SKILLS_ROOT, 'multimedia-use/SKILL.md'), 'utf8')
    const video = readFileSync(join(SKILLS_ROOT, 'video-workflow/SKILL.md'), 'utf8')
    const combined = `${canvas}\n${multimedia}\n${video}`

    expect(combined).not.toContain('SparkWork')
    expect(combined).not.toContain('spark-desktop')
    expect(combined).not.toContain('设置 → 完整性')
    expect(canvas).toContain('49 个')
    expect(video).toContain('设置 → 视频处理 (FFmpeg)')
  })

  it('uses the standalone identity in active Canvas Agent notifications and skill metadata', () => {
    const ipc = readFileSync(join(MAIN_ROOT, 'ipc/index.ts'), 'utf8')
    const skillsManager = readFileSync(join(__dirname, 'AppSkillsManager.ts'), 'utf8')
    const sessionService = readFileSync(
      join(__dirname, '../../../../../packages/agent-runtime/src/services/session.service.ts'),
      'utf8',
    )

    expect(
      ipc.slice(
        ipc.indexOf('function getNodeDefaultTitle'),
        ipc.indexOf('function getNodeDefaultBody'),
      ),
    ).not.toMatch(/SparkWork|Spark Agent/)
    expect(
      skillsManager.slice(
        skillsManager.indexOf("join(metaDir, 'plugin.json')"),
        skillsManager.indexOf('const linked'),
      ),
    ).not.toContain('SparkWork')
    expect(
      sessionService.slice(
        sessionService.indexOf("if (status === 'completed')"),
        sessionService.indexOf('if (TERMINAL_AGENT_STATUSES'),
      ),
    ).not.toContain('Spark Agent')
  })
})
