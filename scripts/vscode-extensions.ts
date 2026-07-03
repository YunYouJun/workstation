#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { vscodeExtensions } from '../vscode.extensions.config'

interface LocaleDocument {
  description: string
  intro: string[]
  locale: 'en' | 'zh'
  path: string
  title: string
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs: LocaleDocument[] = [
  {
    locale: 'zh',
    path: 'docs/vscode/extensions.md',
    title: '扩展',
    description: '我安装过的 VS Code 扩展。',
    intro: [
      '扩展 ID 与英文页保持一致，便于复制、同步和排查。',
      '此页由 `pnpm docs:generate` 根据 `vscode.extensions.config.ts` 生成。',
    ],
  },
  {
    locale: 'en',
    path: 'docs/en/vscode/extensions.md',
    title: 'Extensions',
    description: 'All VS Code extensions I installed.',
    intro: [
      'Extension IDs match the Chinese page for easier copying, syncing, and troubleshooting.',
      'This page is generated from `vscode.extensions.config.ts` with `pnpm docs:generate`.',
    ],
  },
]

const command = process.argv[2] ?? 'write'

if (!['write', 'check'].includes(command)) {
  console.error('Usage: pnpm docs:generate [check]')
  process.exit(1)
}

function marketplaceUrl(id: string): string {
  return `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(id)}`
}

function extensionNote(extension: typeof vscodeExtensions[number], locale: LocaleDocument['locale']): string {
  if (locale === 'zh')
    return extension.noteZh || extension.note || ''

  return extension.note || ''
}

function renderDocument(doc: LocaleDocument): string {
  const lines = [
    `# ${doc.title}`,
    '',
    `> ${doc.description}`,
    '',
    ...doc.intro,
    '',
    ...vscodeExtensions.map((extension) => {
      const note = extensionNote(extension, doc.locale)
      return `- [${extension.id}](${marketplaceUrl(extension.id)})${note ? `: ${note}` : ''}`
    }),
    '',
  ]

  return lines.join('\n')
}

let hasOutdatedDocs = false

for (const doc of docs) {
  const target = join(rootDir, doc.path)
  const content = renderDocument(doc)

  if (command === 'check') {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : ''
    if (current !== content) {
      console.error(`${doc.path} is out of date. Run pnpm docs:generate.`)
      hasOutdatedDocs = true
    }
    continue
  }

  writeFileSync(target, content)
  console.log(`Generated ${doc.path}`)
}

if (hasOutdatedDocs)
  process.exit(1)
