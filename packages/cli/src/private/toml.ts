import { parse } from 'smol-toml'
import { contentHash } from './safe-file'

export function parseTomlDocument(content: string) {
  try {
    return parse(content, { integersAsBigInt: true })
  }
  catch {
    // Parser diagnostics may include secret values from the source line.
    throw new Error('Invalid TOML configuration; fix its syntax before exporting or applying.')
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonical).join(',')}]`
  if (value instanceof Date)
    return `date:${value.toISOString()}`
  if (value && typeof value === 'object')
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return `${typeof value}:${JSON.stringify(String(value))}`
}

/** Compare configuration values, ignoring generated comments, ordering and whitespace. */
export function tomlHash(content: string): string {
  return contentHash(canonical(parseTomlDocument(content)))
}
