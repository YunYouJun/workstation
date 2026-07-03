import type { InventorySection, PrivateManifest } from './types'
import fs from 'node:fs'
import path from 'node:path'
import { expandHome } from './paths'

export function generatePrivateInventory(manifestPath: string, manifest: PrivateManifest, section: InventorySection): string {
  const lines: string[] = []

  if (section === 'skills')
    lines.push('# 本机 Skills 清单')
  else if (section === 'mcp')
    lines.push('# 本机 MCP 清单')
  else
    lines.push('# 本机 Skills / MCP 清单')

  lines.push(
    '',
    `生成日期：${localDate()}`,
    '',
    `同步配置：\`${manifestPath}\``,
    `密钥来源：${manifest.policy?.secretSource || 'unknown'}`,
    '',
    '本文件是生成快照；结构化同步规则只维护在 manifest。',
  )

  if (section === 'skills' || section === 'all')
    printSkillsInventory(lines, manifest)

  if (section === 'mcp' || section === 'all')
    printMcpInventory(lines, manifest)

  return `${lines.join('\n')}\n`
}

function localDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function printSkillsInventory(lines: string[], manifest: PrivateManifest): void {
  lines.push('', '只输出路径、数量、同步模式和 skill 名称；不复制或输出 SKILL.md 正文。')

  for (const root of manifest.skills?.roots || []) {
    const resolved = path.resolve(expandHome(root.path))
    const label = root.label || root.path
    const syncMode = root.syncMode || 'unknown'

    lines.push('', `## ${label}`, '')

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      lines.push(`- 路径不存在：\`${resolved}\``)
      continue
    }

    const total = countSkillFiles(resolved)
    const topSkills = topLevelSkills(resolved)
    lines.push(
      `- 路径：\`${resolved}\``,
      `- 同步模式：${syncMode}`,
      `- SKILL.md 总数：${total}`,
      `- 顶层 skills：${topSkills.length}`,
      '',
      ...topSkills.map(skill => `- ${skill}`),
    )
  }
}

function countSkillFiles(root: string): number {
  let count = 0
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current)
      continue

    for (const entry of safeReadDir(current)) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      }
      else if (entry.isFile() && entry.name === 'SKILL.md') {
        count += 1
      }
    }
  }

  return count
}

function topLevelSkills(root: string): string[] {
  return safeReadDir(root)
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))
}

function safeReadDir(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
  }
  catch {
    return []
  }
}

function printMcpInventory(lines: string[], manifest: PrivateManifest): void {
  lines.push('', '只输出路径、同步模式和 server 名称；不输出 MCP command、args、env、headers 或 token。')

  for (const source of manifest.mcp?.sources || []) {
    const resolved = path.resolve(expandHome(source.path))
    const label = source.label || source.id || source.path
    const syncMode = source.syncMode || 'unknown'

    if (source.format === 'json') {
      printJsonMcpServers(lines, resolved, label, syncMode)
    }
    else if (source.format === 'toml-codex') {
      printCodexTomlMcpServers(lines, resolved, label, syncMode)
    }
    else {
      lines.push('', `## ${label}`, '', `- 路径：\`${resolved}\``, `- 同步模式：${syncMode}`, `- 未支持的格式：${source.format || 'unknown'}`)
    }
  }

  if (manifest.mcp?.ignoredSources?.length) {
    lines.push('', '## 忽略的 MCP 来源', '')
    for (const source of manifest.mcp.ignoredSources) {
      const reason = source.reason ? `（原因：${source.reason}）` : ''
      lines.push(`- 路径：\`${expandHome(source.path)}\`${reason}`)
    }
  }

  if (manifest.mcp?.localOutputs?.length) {
    lines.push('', '## 本地输出', '')
    for (const output of manifest.mcp.localOutputs) {
      const reason = output.reason ? `（原因：${output.reason}）` : ''
      lines.push(`- 路径：\`${output.path}\`${reason}`)
    }
  }
}

function printJsonMcpServers(lines: string[], file: string, label: string, syncMode: string): void {
  lines.push('', `## ${label}`, '')

  if (!fs.existsSync(file)) {
    lines.push(`- 路径不存在：\`${file}\``)
    return
  }

  lines.push(`- 路径：\`${file}\``, `- 同步模式：${syncMode}`)

  const keys = jsonMcpServerKeys(file)
  if (keys.length === 0) {
    lines.push('- 未解析到 server key。')
    return
  }

  lines.push(...keys.map(key => `- ${key}`))
}

function jsonMcpServerKeys(file: string): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const servers = data?.mcpServers || data?.mcp_servers || {}
    if (!servers || typeof servers !== 'object' || Array.isArray(servers))
      return []

    return Object.keys(servers).sort((a, b) => a.localeCompare(b))
  }
  catch {
    return []
  }
}

function printCodexTomlMcpServers(lines: string[], file: string, label: string, syncMode: string): void {
  lines.push('', `## ${label}`, '')

  if (!fs.existsSync(file)) {
    lines.push(`- 路径不存在：\`${file}\``)
    return
  }

  lines.push(`- 路径：\`${file}\``, `- 同步模式：${syncMode}`)

  const keys = codexTomlMcpServerKeys(file)
  if (keys.length === 0) {
    lines.push('- 未解析到 server key。')
    return
  }

  lines.push(...keys.map(key => `- ${key}`))
}

function codexTomlMcpServerKeys(file: string): string[] {
  const keys = new Set<string>()

  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*\[mcp_servers\.([^.\]]+)/)
    if (match)
      keys.add(match[1].replace(/^["']|["']$/g, ''))
  }

  return [...keys].sort((a, b) => a.localeCompare(b))
}
