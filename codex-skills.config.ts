import { readFileSync } from 'node:fs'

export interface GitHubCodexSkillSource {
  type: 'github'
  repo: string
  path: string
  ref?: string
}

export interface LocalCodexSkillSource {
  type: 'local'
  path: string
}

export type CodexSkillSource = GitHubCodexSkillSource | LocalCodexSkillSource

export interface CodexSkill {
  id: string
  description: string
  source: CodexSkillSource
  targetName?: string
  syncMode?: 'install' | 'inventory-only' | 'project-owned'
  visibility?: 'public' | 'private' | 'internal' | 'system'
}

interface CodexToolsManifest {
  skills?: {
    install?: CodexSkill[]
  }
}

const publicManifestUrl = new URL('./config/codex-tools.manifest.json', import.meta.url)
const publicManifest = JSON.parse(readFileSync(publicManifestUrl, 'utf-8')) as CodexToolsManifest

export const codexSkills: CodexSkill[] = publicManifest.skills?.install || []
