import { SkillService } from '@spark/agent-runtime'
import { SkillRepository, type SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getAppSkillsManager } from './AppSkillsManager.js'

const log = createLogger('canvas-skills-bootstrap')
const CANVAS_RUNTIME_SKILLS = new Map([
  ['builtin:canvas-studio', 'canvas-studio'],
  ['builtin:multimedia-use', 'multimedia-use'],
  ['builtin:video-workflow', 'video-workflow'],
  ['builtin:platform-manager', 'platform-manager'],
])

export function filterCanvasRuntimeSkills<T extends { id: string }>(skills: readonly T[]): T[] {
  return skills.filter((skill) => CANVAS_RUNTIME_SKILLS.has(skill.id))
}

export interface CanvasSkillDirectories {
  managedPluginDir: string
  userDir: string
}

interface CanvasSkillsBootstrapDeps extends CanvasSkillDirectories {
  ensureBuiltInSkills(): void
  listSkills(): Array<{ id: string; name: string; enabled: boolean; rootPath: string | null }>
  deleteSkillRecord(id: string): boolean
  buildManagedPluginDir(skills: Array<{ name: string; rootPath: string }>): void
  autoImportHostSkills?(): unknown
}

let directories: CanvasSkillDirectories | null = null

export function bootstrapCanvasSkills(deps: CanvasSkillsBootstrapDeps): CanvasSkillDirectories {
  deps.ensureBuiltInSkills()
  const skills = deps.listSkills()
  for (const skill of skills) {
    if (skill.id.startsWith('builtin:') && !CANVAS_RUNTIME_SKILLS.has(skill.id)) {
      deps.deleteSkillRecord(skill.id)
    }
  }
  const enabled = filterCanvasRuntimeSkills(skills).flatMap((skill) => {
    const runtimeName = CANVAS_RUNTIME_SKILLS.get(skill.id)
    if (
      !skill.enabled ||
      runtimeName == null ||
      skill.rootPath == null ||
      skill.rootPath.includes('://')
    ) {
      return []
    }
    return [{ name: runtimeName, rootPath: skill.rootPath }]
  })
  deps.buildManagedPluginDir(enabled)
  return {
    managedPluginDir: deps.managedPluginDir,
    userDir: deps.userDir,
  }
}

export function initializeCanvasSkillsMetadata(
  database: SparkDatabase = getDatabase(),
): CanvasSkillDirectories {
  if (directories != null) return directories
  const manager = getAppSkillsManager()
  const skillRepository = new SkillRepository(database)
  const skillService = new SkillService(skillRepository, manager.bundledDir)
  directories = bootstrapCanvasSkills({
    ensureBuiltInSkills: () => skillService.ensureBuiltInSkills(),
    listSkills: () => skillService.listSkills(),
    deleteSkillRecord: (id) => skillRepository.deleteById(id),
    buildManagedPluginDir: (skills) => manager.buildManagedPluginDir(skills),
    managedPluginDir: manager.managedPluginDir,
    userDir: manager.userDir,
  })
  log.info(`Canvas skills metadata initialized: ${directories.managedPluginDir}`)
  return directories
}

export function getCanvasSkillDirectories(): CanvasSkillDirectories {
  return directories ?? initializeCanvasSkillsMetadata()
}
