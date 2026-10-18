import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'vitest'
import { createTempDir, removePath, writeFile } from './utils'

const guardPath = fileURLToPath(new URL('../../../home/dot_local/libexec/executable_git-confirm-large-push', import.meta.url))
const tempDirs: string[] = []
const remoteUrl = 'git@github.com:example/repo.git'
const report = 'Git pack: 2 MiB; LFS candidates: 120 MiB\n[超限] assets/hero.psd 120 MiB\n'

function fixture(code = 1, confirm = 1, output = report) {
  const root = createTempDir('yunbox-guard-adapter-')
  tempDirs.push(root)
  const bin = path.join(root, 'bin')
  const home = path.join(root, 'home')
  fs.mkdirSync(bin)
  fs.mkdirSync(home)
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1', PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`, WORKSTATION_YUNBOX_BIN: path.join(bin, 'yunbox') }
  execFileSync('git', ['init', '-q'], { cwd: root, env })
  writeFile(path.join(bin, 'yunbox'), `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('cli-input', fs.readFileSync(0))
fs.writeFileSync('cli-args', JSON.stringify(process.argv.slice(2)))
process.stdout.write(${JSON.stringify(output)})
process.exit(${code})
`)
  writeFile(path.join(bin, 'osascript'), `#!/usr/bin/env node
require('node:fs').writeFileSync('dialog-args', JSON.stringify(process.argv.slice(2)))
process.exit(${confirm})
`)
  fs.chmodSync(path.join(bin, 'yunbox'), 0o755)
  fs.chmodSync(path.join(bin, 'osascript'), 0o755)
  return { root, env }
}

function run(f: ReturnType<typeof fixture>, url = remoteUrl, name = 'origin', input = 'ref local ref remote\n') {
  return spawnSync(guardPath, [name, url], { cwd: f.root, env: f.env, input, encoding: 'utf8' })
}

afterEach(() => {
  while (tempDirs.length)
    removePath(tempDirs.pop())
})

describe('yunBox push-guard adapter', () => {
  it('forwards hook input and an explicit legacy threshold without implementing size rules', () => {
    const f = fixture()
    execFileSync('git', ['config', 'workstation.largePushGuardBytes', '900k'], { cwd: f.root, env: f.env })
    const result = run(f)
    assert.equal(result.status, 1)
    assert.equal(fs.readFileSync(path.join(f.root, 'cli-input'), 'utf8'), 'ref local ref remote\n')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'cli-args'), 'utf8')), ['inspect', '--push', '--stdin', '--remote', remoteUrl, '--git-limit', '921600'])
    const dialog = JSON.parse(fs.readFileSync(path.join(f.root, 'dialog-args'), 'utf8'))
    assert.deepEqual(dialog, ['-', 'github.com/example/repo', 'origin', report.trimEnd()])
    assert.ok(result.stderr.includes(report.trimEnd()))
  })

  it('silently accepts a below-budget report and skips other hosts', () => {
    const f = fixture(0)
    const result = run(f)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    assert.equal(fs.existsSync(path.join(f.root, 'dialog-args')), false)
    fs.unlinkSync(path.join(f.root, 'cli-input'))
    assert.equal(run(f, 'git@git.example.com:example/repo.git').status, 0)
    assert.equal(fs.existsSync(path.join(f.root, 'cli-input')), false)
  })

  it('respects cancellation and approval of the same YunBox report', () => {
    assert.equal(run(fixture(1, 1)).status, 1)
    assert.equal(run(fixture(1, 0)).status, 0)
  })

  it('blocks missing, failed and incompatible inspectors without a confirmation bypass', () => {
    const missing = fixture()
    fs.unlinkSync(missing.env.WORKSTATION_YUNBOX_BIN)
    assert.match(run(missing).stderr, /找不到 YunBox CLI/)
    for (const f of [fixture(2), fixture(127), fixture(1, 0, '')]) {
      assert.equal(run(f).status, 1)
      assert.equal(fs.existsSync(path.join(f.root, 'dialog-args')), false)
    }
  })

  it('defers the named hook to a composed repository hook, but checks inside that chain', () => {
    const f = fixture()
    writeFile(path.join(f.root, '.git', 'hooks', 'pre-push'), '#!/bin/sh\n# yunbox-pre-push-v1\n')
    fs.chmodSync(path.join(f.root, '.git', 'hooks', 'pre-push'), 0o755)
    assert.equal(run(f).status, 0)
    assert.equal(fs.existsSync(path.join(f.root, 'cli-input')), false)
    const chained = { ...f, env: { ...f.env, WORKSTATION_YUNBOX_CHAIN: '1' } }
    assert.equal(run(chained).status, 1)
    assert.equal(fs.existsSync(path.join(f.root, 'cli-input')), true)
  })

  it('does not expose credentials from a direct remote URL in the dialog', () => {
    const f = fixture()
    const url = 'https://oauth2:secret@github.com/example/repo.git?token=secret#fragment'
    run(f, url, url)
    const dialog = fs.readFileSync(path.join(f.root, 'dialog-args'), 'utf8')
    assert.doesNotMatch(dialog, /secret/)
    assert.match(dialog, /github.com\/example\/repo/)
    assert.match(dialog, /直接地址/)
  })
})
