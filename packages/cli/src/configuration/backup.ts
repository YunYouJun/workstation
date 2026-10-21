import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export interface ConfigurationArchive {
  version: 1
  audience: 'personal' | 'work'
  files: { sourceId: string, sourceAudience: 'public' | 'personal' | 'work', path: string, content: string | null }[]
}
const aad = Buffer.from('workstation-configuration-backup-v1')
const maximumBytes = 1024 * 1024
function key(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 16 || passphrase.length > 4096)
    throw new Error('Backup passphrase must contain between 16 and 4096 characters')
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}
/** Authenticated, versioned archive. Passphrases are supplied only by the host environment. */
export function encryptConfiguration(archive: ConfigurationArchive, passphrase: string): string {
  const plaintext = JSON.stringify(archive)
  if (Buffer.byteLength(plaintext) > maximumBytes)
    throw new Error('Backup exceeds its size limit')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const derived = key(passphrase, salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', derived, iv)
    cipher.setAAD(aad)
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return `${JSON.stringify({ format: 'workstation-configuration-backup', version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') })}\n`
  }
  finally { derived.fill(0) }
}

/** Reject malformed, tampered or wrong-key archives before returning any plaintext. */
export function decryptConfiguration(content: string, passphrase: string): ConfigurationArchive {
  try {
    if (Buffer.byteLength(content) > maximumBytes * 2)
      throw new Error('Size')
    const value = JSON.parse(content)
    if (value.format !== 'workstation-configuration-backup' || value.version !== 1 || !['salt', 'iv', 'tag', 'data'].every(name => typeof value[name] === 'string' && /^[A-Z0-9+/]*={0,2}$/i.test(value[name])))
      throw new Error('Format')
    const salt = Buffer.from(value.salt, 'base64')
    const iv = Buffer.from(value.iv, 'base64')
    const tag = Buffer.from(value.tag, 'base64')
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16)
      throw new Error('Format')
    const derived = key(passphrase, salt)
    let plaintext: Buffer
    try {
      const decipher = createDecipheriv('aes-256-gcm', derived, iv)
      decipher.setAAD(aad)
      decipher.setAuthTag(tag)
      plaintext = Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()])
    }
    finally { derived.fill(0) }
    if (plaintext.length > maximumBytes)
      throw new Error('Size')
    const archive = JSON.parse(plaintext.toString('utf8'))
    if (archive.version !== 1 || !['personal', 'work'].includes(archive.audience) || !Array.isArray(archive.files) || archive.files.length > 2000 || archive.files.some((file: ConfigurationArchive['files'][number]) => typeof file.sourceId !== 'string' || !['public', 'personal', 'work'].includes(file.sourceAudience) || typeof file.path !== 'string' || !(file.content === null || typeof file.content === 'string') || (typeof file.content === 'string' && (Buffer.byteLength(file.content) > 2 * 1024 * 1024 || file.content.includes('\0')))))
      throw new Error('Format')
    return archive
  }
  catch { throw new Error('Backup cannot be decrypted or validated. Check the passphrase and archive.') }
}
