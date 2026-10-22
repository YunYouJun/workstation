import { describe, expect, it } from 'vitest'
import { previewText } from '../src/configuration/preview-text'

describe('readable configuration previews', () => {
  it('keeps prose, comments, blank lines and more than 200 lines verbatim', () => {
    const content = `# Instructions\r\n\r\nUse conventional commits.\r\n${
      Array.from({ length: 240 }, (_, index) => `# Section ${index}\r\n`).join('')}`
    expect(previewText(content)).toBe(content)
    expect(previewText('export EDITOR=vim\nalias ll="ls -la"\n')).toBe('export EDITOR=vim\nalias ll="ls -la"\n')
  })

  it('masks credential assignments and preserves references', () => {
    const envReference = '$' + '{API_TOKEN}'
    const content = `export API_TOKEN="fixture-secret"\npassword: "fixture-password"\nTOKEN=${envReference}\nbearer_token_env_var="API_TOKEN"\n`
    const result = previewText(content)
    expect(result).not.toContain('fixture-secret')
    expect(result).not.toContain('fixture-password')
    expect(result).toContain('export API_TOKEN="[value withheld]"')
    expect(result).toContain(`TOKEN=${envReference}`)
    expect(result).toContain('bearer_token_env_var="API_TOKEN"')
    expect(result.split('\n')).toHaveLength(content.split('\n').length)
  })

  it('masks arbitrary TOML headers including multiline values without hiding later settings', () => {
    const content = '[mcp_servers.demo.http_headers]\n"X-Custom" = """fixture-first\nfixture-second\n"""\n[mcp_servers.demo]\nenabled = true\n'
    const result = previewText(content)
    expect(result).not.toContain('fixture-first')
    expect(result).not.toContain('fixture-second')
    expect(result).toContain('enabled = true')
    expect(result.split('\n')).toHaveLength(content.split('\n').length)
  })

  it('masks private keys, URL credentials and authorization headers', () => {
    const content = '# Connection\nhttps://user:fixture-password@example.test/api?token=fixture-token&mode=read\nAuthorization: Bearer fixture-auth\n-----BEGIN PRIVATE KEY-----\nfixture-key\n-----END PRIVATE KEY-----\n'
    const result = previewText(content)
    for (const secret of ['fixture-password', 'fixture-token', 'fixture-auth', 'fixture-key'])
      expect(result).not.toContain(secret)
    expect(result).toContain('# Connection')
    expect(result).toContain('&mode=read')
    expect(result.split('\n')).toHaveLength(content.split('\n').length)
  })
})
