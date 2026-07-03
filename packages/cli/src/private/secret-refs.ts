import type { SecretReference } from './types'
import fs from 'node:fs'

export function readSecretReferences(envFile: string): SecretReference[] {
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  const refs: SecretReference[] = []
  let nextOptional = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (/^#\s*optional\b/i.test(trimmed)) {
      nextOptional = true
      continue
    }

    if (!trimmed || trimmed.startsWith('#'))
      continue

    const assignment = parseEnvAssignment(line)
    if (!assignment) {
      nextOptional = false
      continue
    }

    const { key: envName, value: rawValue } = assignment
    const value = unquote(rawValue)

    if (!value.startsWith('op://')) {
      nextOptional = false
      continue
    }

    refs.push(parseSecretReference(envName, value, nextOptional))
    nextOptional = false
  }

  return refs
}

export function secretReferencePath(ref: SecretReference): string {
  return `op://${ref.vault}/${ref.item}/${ref.field}`
}

export function parseEnvAssignment(line: string): { key: string, value: string } | undefined {
  const equalsIndex = line.indexOf('=')
  if (equalsIndex === -1)
    return undefined

  const key = line.slice(0, equalsIndex).trim()
  if (!isEnvName(key))
    return undefined

  return {
    key,
    value: line.slice(equalsIndex + 1).trim(),
  }
}

export function unquote(value: string): string {
  const trimmed = value.trim()
  const quote = trimmed[0]

  if ((quote === '"' || quote === '\'') && trimmed.endsWith(quote))
    return trimmed.slice(1, -1)

  return trimmed
}

export function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

export function isAsciiDigit(char: string): boolean {
  const code = char.charCodeAt(0)
  return code >= 48 && code <= 57
}

function parseSecretReference(envName: string, ref: string, optional: boolean): SecretReference {
  const segments = ref.slice('op://'.length).split('/')

  if (segments.length < 3)
    throw new Error(`Invalid 1Password secret reference: ${ref}`)

  const [vault, item, ...fieldParts] = segments

  return {
    envName,
    field: fieldParts.join('/'),
    item,
    optional,
    ref,
    vault,
  }
}

function isEnvName(value: string): boolean {
  if (!value)
    return false

  if (!isAsciiLetter(value[0]) && value[0] !== '_')
    return false

  for (const char of value.slice(1)) {
    if (!isAsciiLetter(char) && !isAsciiDigit(char) && char !== '_')
      return false
  }

  return true
}
