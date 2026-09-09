/** Version 1 display contract. Raw configuration values never cross this boundary. */
export interface ConfigurationItem {
  id: string
  title: string
  kind: 'mcp' | 'skill' | 'instructions' | 'terminal'
  owner: 'user' | 'project' | 'installer'
  origin: 'public' | 'private' | 'local'
  localPath: string
  sourcePath?: string
  status: 'synced' | 'local-modified' | 'source-modified' | 'conflict' | 'first-adoption' | 'unmanaged' | 'read-only' | 'error'
  revision: string
  local: string
  source: string
  fields: string[]
  management?: string
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
  changes: { path: string, direction: 'to-local' | 'to-source', before: string, after: string, deletion: boolean }[]
}
