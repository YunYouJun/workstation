/** Version 1 display contract. Raw configuration values never cross this boundary. */
export interface ConfigurationItem {
  id: string
  sourceId?: string
  audience?: 'public' | 'personal' | 'work' | 'unclassified'
  resource?: string
  competingSources?: string[]
  title: string
  kind: 'mcp' | 'skill' | 'instructions' | 'terminal'
  owner: 'user' | 'project' | 'installer'
  origin: 'public' | 'private' | 'local'
  localPath: string
  sourcePath?: string
  status: 'synced' | 'local-modified' | 'source-modified' | 'conflict' | 'first-adoption' | 'unmanaged' | 'read-only' | 'error' | 'ownership-conflict'
  revision: string
  local: string
  source: string
  fields: string[]
  management?: string
  client?: string
  scope?: 'global' | 'project'
  manager?: string
  provenance?: { label: string, path?: string }
}

/** Display-safe Skills diagnostics. Audit failures do not hide the existing configuration inventory. */
export interface ConfigurationSkillsAudit {
  state: 'available' | 'error'
  checkedAt: string
  summary?: { skillFileCount: number, implicitSkillCount: number, explicitOnlySkillCount: number, warningCount: number, errorCount: number }
  findings: { code: string, severity: 'warning' | 'error', message: string, paths: string[] }[]
  message?: string
}

export interface ConfigurationDecision {
  id: string
  revision: string
  choice: 'local' | 'source' | 'merge' | 'skip'
  /** Explicit per-field decisions, including on first adoption. No inferred three-way merge. */
  fields?: Record<string, 'local' | 'source'>
}

export interface ConfigurationPreview {
  version: 1
  planId: string
  changes: { path: string, direction: 'to-local' | 'to-source' | 'to-backup', before: string, after: string, deletion: boolean }[]
}
