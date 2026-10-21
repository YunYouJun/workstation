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
const report = '推送检查：超过限额，需要确认\n  ! Git pack 2 MiB 超过 900 KiB\n[超限] 新增  120 MiB  LFS "assets/hero.psd"\n'
const quietReport = '推送检查：未超限\nGit pack 预计上传量：12 KiB；限额 900 KiB\n'
const confirmHelp = '用法：yunbox inspect --push [选项]\n  --confirm           超限时询问是否继续\n'

function fixture(code = 1, output = report, help = confirmHelp) {
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
const args = process.argv.slice(2)
if (args.includes('--version')) {
  process.stdout.write('0.1.2\\n')
  process.exit(0)
}
if (args.includes('--help')) {
  process.stdout.write(${JSON.stringify(help)})
  process.exit(0)
}
fs.writeFileSync('cli-input', fs.readFileSync(0))
fs.writeFileSync('cli-args', JSON.stringify(args))
process.stdout.write(${JSON.stringify(output)})
process.exit(${code})
`)
  writeFile(path.join(bin, 'osascript'), `#!/usr/bin/env node
require('node:fs').writeFileSync('dialog-args', JSON.stringify(process.argv.slice(2)))
process.exit(0)
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
  it('forwards hook input and an explicit legacy threshold to the YunBox confirmation', () => {
    const f = fixture()
    execFileSync('git', ['config', 'workstation.largePushGuardBytes', '900k'], { cwd: f.root, env: f.env })
    const result = run(f)
    assert.equal(result.status, 1)
    assert.equal(fs.readFileSync(path.join(f.root, 'cli-input'), 'utf8'), 'ref local ref remote\n')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'cli-args'), 'utf8')), ['inspect', '--push', '--stdin', '--remote', remoteUrl, '--confirm', '--git-limit', '921600'])
    assert.equal(result.stderr, report)
    assert.equal(fs.existsSync(path.join(f.root, 'dialog-args')), false)
  })

  it('silently accepts a below-budget report and skips other hosts', () => {
    const f = fixture(0, quietReport)
    const result = run(f)
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
    fs.unlinkSync(path.join(f.root, 'cli-input'))
    assert.equal(run(f, 'git@git.example.com:example/repo.git').status, 0)
    assert.equal(fs.existsSync(path.join(f.root, 'cli-input')), false)
  })

  it('leaves approval and cancellation to YunBox without asking again', () => {
    for (const [code, status] of [[0, 0], [1, 1]] as const) {
      const f = fixture(code)
      const result = run(f)
      assert.equal(result.status, status)
      assert.equal(result.stderr, report)
      assert.equal(fs.existsSync(path.join(f.root, 'dialog-args')), false)
    }
    // A freeze window blocks before any report is printed.
    assert.equal(run(fixture(1, '')).status, 1)
  })

  it('blocks missing, failed and incompatible inspectors without a confirmation bypass', () => {
    const missing = fixture()
    fs.unlinkSync(missing.env.WORKSTATION_YUNBOX_BIN)
    assert.match(run(missing).stderr, /找不到 YunBox CLI/)
    for (const f of [fixture(2, ''), fixture(127, '')]) {
      const result = run(f)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /YunBox 检查失败（退出码 (2|127)）/)
      assert.equal(fs.existsSync(path.join(f.root, 'dialog-args')), false)
    }
    const outdated = run(fixture(2, '', '用法：yunbox inspect --push [选项]\n  --json\n'))
    assert.equal(outdated.status, 1)
    assert.match(outdated.stderr, /YunBox CLI 0\.1\.2 不支持 inspect --confirm。请升级到 0\.1\.3/)
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
})
