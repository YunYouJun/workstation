#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { projectManifestSchema } from '../packages/cli/src/projects-manifest'

const mode = process.argv[2] ?? 'generate'
if (!['generate', 'check'].includes(mode)) {
  console.error('Usage: pnpm projects:schema [generate|check]')
  process.exit(1)
}
const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../schemas/projects.schema.json')
const content = `${JSON.stringify(projectManifestSchema, null, 2)}\n`
if (mode === 'check') {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
    console.error('schemas/projects.schema.json is out of date. Run pnpm projects:schema.')
    process.exitCode = 1
  }
}
else {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  console.log('Generated schemas/projects.schema.json')
}
