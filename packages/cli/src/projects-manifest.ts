/** Shared repository property names preserve existing shorthand and URL aliases. */
export const projectRepositoryFields = {
  name: ['name'],
  description: ['description'],
  path: ['path', 'remotePath', 'repo', 'repository'],
  sshUrl: ['sshUrl', 'ssh'],
  httpsUrl: ['httpsUrl', 'https'],
  url: ['url'],
} as const

/** Stable editor schema location for project manifests in downstream repositories. */
export const projectManifestSchemaUrl = 'https://raw.githubusercontent.com/YunYouJun/workstation/main/schemas/projects.schema.json'

const nonEmptyString = { type: 'string', pattern: '\\S' }
const repositoryPropertyNames = Object.values(projectRepositoryFields).flat()

/** Editor schema for the existing versionless format; the CLI owns semantic validation. */
export const projectManifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: projectManifestSchemaUrl,
  title: 'Workstation project manifest',
  description: 'Existing versionless projects.yaml format. Use workstation host-json validate-projects for host inheritance, target inference and duplicate checks.',
  type: 'object',
  additionalProperties: true,
  properties: {
    host: { ...nonEmptyString, description: 'Default Git host for shorthand repository paths.' },
    root: { ...nonEmptyString, description: 'Default checkout root. Validation does not expand or inspect directories.' },
    repositories: { $ref: '#/$defs/repositories' },
    groups: {
      type: 'object',
      propertyNames: nonEmptyString,
      additionalProperties: { $ref: '#/$defs/group' },
    },
  },
  anyOf: [{ required: ['repositories'] }, { required: ['groups'] }],
  $defs: {
    repository: {
      anyOf: [
        nonEmptyString,
        {
          type: 'object',
          additionalProperties: true,
          properties: Object.fromEntries(repositoryPropertyNames.map(key => [key, nonEmptyString])),
          anyOf: repositoryPropertyNames.filter(key => key !== 'description').map(key => ({ required: [key] })),
        },
      ],
    },
    repositories: { type: 'array', items: { $ref: '#/$defs/repository' } },
    group: {
      type: 'object',
      additionalProperties: true,
      required: ['repositories'],
      properties: {
        host: nonEmptyString,
        root: nonEmptyString,
        repositories: { $ref: '#/$defs/repositories' },
      },
    },
  },
} as const

/** Stable display-safe result from pure content validation, without source values or parser excerpts. */
export interface ProjectManifestValidationReport {
  version: 1
  valid: boolean
  issues: { code: string, path: string, message: string }[]
  summary?: { repositories: number, groups: number }
}
