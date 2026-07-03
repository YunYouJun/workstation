export type PrivateAction
  = | 'apply'
    | 'check'
    | 'connect'
    | 'inventory'
    | 'ios-materialize'
    | 'ios-run'
    | 'ios-secrets-import'
    | 'list'
    | 'mcp-inject'
    | 'mcp-run'
    | 'secret-scan'
    | 'secrets-check'
    | 'secrets-import'
    | 'status'

export type InventorySection = 'all' | 'mcp' | 'skills'
export type SecretScanMode = 'all' | 'staged'

export interface PrivateManifest {
  mcp?: {
    fragments?: McpFragment[]
    ignoredSources?: IgnoredSource[]
    localOutputs?: LocalOutput[]
    sources?: McpSource[]
    templates?: McpTemplate[]
  }
  policy?: {
    opAccount?: OpAccountPolicy
    plaintextSecretsAllowed?: boolean
    relatedRepositories?: RelatedRepository[]
    secretSource?: string
  }
  secrets?: {
    envTemplates?: SecretEnvTemplate[]
  }
  skills?: {
    install?: PrivateSkill[]
    roots?: SkillRoot[]
  }
  workstationOverlay?: OverlayContract
}

export interface OpAccountPolicy {
  accountEnvPath?: string
  defaultName?: string
  defaultUserId?: string
  vault?: string
}

export interface RelatedRepository {
  id: string
  path: string
  role?: string
}

export interface OverlayContract {
  allowedOperations?: string[]
  allowedReadPaths?: string[]
  contractVersion?: number
  defaultMode?: string
  localIgnoredOutputs?: string[]
  neverApply?: string[]
  secretSource?: string
}

export interface McpTemplate {
  id: string
  operation?: string
  outputPath?: string
  path: string
  usage?: string
}

export interface McpFragment {
  format?: string
  id: string
  operation?: string
  path: string
}

export interface McpSource {
  format?: string
  id?: string
  label?: string
  path: string
  syncMode?: string
}

export interface IgnoredSource {
  path: string
  reason?: string
}

export interface LocalOutput {
  gitIgnored?: boolean
  path: string
  reason?: string
}

export interface SecretEnvTemplate {
  id: string
  materializer?: 'app-store-connect-key'
  operation?: string
  path: string
  usage?: string
}

export interface SkillRoot {
  label?: string
  path: string
  syncMode?: string
}

export interface PrivateSkill {
  description?: string
  id: string
  source: {
    path?: string
    repo?: string
    type: string
  }
  targetName?: string
}

export interface PrivateOptions {
  dryRun: boolean
  envFile?: string
  manifest: string
  output?: string
  passthrough: string[]
  positionals: string[]
  repo?: string
  scanMode: SecretScanMode
  section: InventorySection
  targetDir?: string
  template?: string
  yes: boolean
}

export interface ParsedCommand {
  action: PrivateAction
  options: PrivateOptions
}

export interface CommandResult {
  status: number
  stdout: string
  stderr: string
}

export interface OpContext {
  account: string
  accountFile?: string
  itemTags: string[]
  repoRoot: string
  vault?: string
}

export interface SecretReference {
  envName: string
  field: string
  item: string
  optional: boolean
  ref: string
  vault: string
}
