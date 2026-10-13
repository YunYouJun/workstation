import { describe, expect, it } from 'vitest'
import { configurationErrorMessage } from '../src/configuration/protocol'

const fallback = 'Configuration operation failed. Check local permissions, source syntax and recovery history.'
const recoveryErrors = [
  'Skill ownership changed after application. Review the original installer before recovery.',
  'Skill ownership is unavailable. Check installer locks before recovery.',
]

describe('configuration protocol errors', () => {
  it.each(recoveryErrors)('returns fixed recovery guidance: %s', (message) => {
    expect(configurationErrorMessage(new Error(message))).toBe(message)
  })

  it.each(recoveryErrors)('withholds arbitrary variations of recovery guidance: %s', (message) => {
    expect(configurationErrorMessage(new Error(`${message} secret-parser-content`))).toBe(fallback)
    expect(configurationErrorMessage(new Error(`secret-parser-content ${message}`))).toBe(fallback)
    expect(configurationErrorMessage(new Error(`${message}\nsecret-parser-content`))).toBe(fallback)
    expect(configurationErrorMessage(new Error(message.slice(0, -1)))).toBe(fallback)
    expect(configurationErrorMessage({ message })).toBe(fallback)
    expect(configurationErrorMessage(message)).toBe(fallback)
  })

  it('keeps existing review guidance and masks unrelated diagnostic details', () => {
    const message = 'Configuration changed. Refresh and preview again.'
    expect(configurationErrorMessage(new Error(message))).toBe(message)
    expect(configurationErrorMessage(new Error('Syntax error with secret-parser-content'))).toBe(fallback)
    expect(configurationErrorMessage(null)).toBe(fallback)
  })
})
