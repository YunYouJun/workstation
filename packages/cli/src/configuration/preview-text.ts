const hidden = '[value withheld]'
const sensitiveKey = /api[_-]?key|authorization|bearer|cookie|password|passwd|secret|credential|(?:^|[_-])token(?:$|[_-])|private[_-]?key/i
const reference = /^(?:\$\{[A-Z_][A-Z0-9_]*\}|\$[A-Z_][A-Z0-9_]*|op:\/\/\S+)$/

function maskLiteral(value: string): string {
  const quote = value.startsWith('"""') || value.startsWith('\'\'\'') ? value.slice(0, 3) : /^["']/.test(value) ? value[0] : ''
  const body = quote ? value.slice(quote.length, value.endsWith(quote) ? -quote.length : undefined) : value
  if (reference.test(body))
    return value
  // Keep line boundaries so displayed line numbers still correspond to the text.
  return quote + body.replace(/[^\r\n]+/g, hidden) + (quote && value.endsWith(quote) ? quote : '')
}

/** Show local review text while masking recognizable credential literals, without adding line metadata. */
export function previewText(content: string): string {
  const text = content
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, block => block.replace(/[^\r\n]+/g, hidden))
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[credentials withheld]@')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&#\s"']+/gi, `$1${hidden}`)
    .replace(/\b(Bearer|Basic)[ \t]+[\w+/.=~-]+/gi, `$1 ${hidden}`)
    .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, hidden)
  const tables = [...text.matchAll(/^[ \t]*\[([^\]\r\n]+)\][^\r\n]*$/gm)]
  let tableIndex = -1
  return text.replace(/(["']?[\w.-]+["']?[ \t]*[:=][ \t]*)("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'[^']*'|\$\{[A-Z_][A-Z0-9_]*\}|[^\s,;\]}]+)/g, (assignment, prefix: string, value: string, offset: number) => {
    while (tableIndex + 1 < tables.length && tables[tableIndex + 1].index! < offset)
      tableIndex++
    const table = tables[tableIndex]?.[1].replace(/["']/g, '') ?? ''
    const credentialTable = /(?:^|\.)(?:env|http_headers|headers|secrets|credentials)$/.test(table)
    const key = prefix.replace(/[ \t]*[:=][ \t]*$/, '').replace(/["']/g, '')
    return (credentialTable || sensitiveKey.test(key)) && !/_env_var$/i.test(key) ? prefix + maskLiteral(value) : assignment
  })
}
