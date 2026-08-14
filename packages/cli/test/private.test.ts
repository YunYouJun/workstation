import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import { readSecretReferences } from '../src/private'
import { privateAllowedOperations } from '../src/private/manifest'
import { createTempDir, removePath, runCli, writeFile } from './utils'

let tempDir: string | undefined

function writeExecutable(filePath: string, lines: string[]) {
  const nodePath = process.execPath.replace(/'/g, `'\\''`)
  writeFile(filePath, [
    '#!/bin/sh',
    `exec '${nodePath}' - "$@" <<'__WORKSTATION_FAKE_NODE__'`,
    ...lines,
    '__WORKSTATION_FAKE_NODE__',
    '',
  ].join('\n'))
  fs.chmodSync(filePath, 0o755)
}

function createPrivateFixture() {
  tempDir = createTempDir('workstation-private-')
  const repoRoot = path.join(tempDir, 'repo')
  const homeRoot = path.join(tempDir, 'home')
  const binDir = path.join(tempDir, 'bin')
  fs.mkdirSync(repoRoot, { recursive: true })
  fs.mkdirSync(homeRoot, { recursive: true })
  fs.mkdirSync(binDir, { recursive: true })

  const manifestPath = path.join(repoRoot, 'config', 'sync-manifest.json')
  writeFile(manifestPath, JSON.stringify({
    version: 1,
    visibility: 'private',
    policy: {
      secretSource: '1Password',
      opAccount: {
        accountEnvPath: 'mcp/op-account.env.example',
        defaultUserId: 'TESTACCOUNT',
        vault: 'Private',
      },
      plaintextSecretsAllowed: false,
      relatedRepositories: [
        {
          id: 'workstation',
          path: path.resolve(import.meta.dirname, '..', '..', '..'),
          role: 'test workstation checkout',
        },
      ],
    },
    workstationOverlay: {
      contractVersion: 1,
      defaultMode: 'dry-run',
      secretSource: '1Password',
      allowedOperations: [
        'inventory',
        'mcp-export',
        'op-account-select',
        'op-run-env',
        'op-inject-template',
        'op-run-wrapper',
        'op-typescript-cli',
        'private-skill-install',
        'secret-scan',
        'managed-block-fragment',
      ],
      allowedReadPaths: [
        'mcp/*.env.example',
        'mcp/*.op.example.json',
        'mcp/codex-mcp.overlay.toml',
        'ios/*.env.example',
        'skills/install/*',
      ],
      localIgnoredOutputs: [
        'mcp/mcp.local.json',
      ],
      neverApply: [
        '$HOME/.codex/config.toml',
      ],
    },
    secrets: {
      envTemplates: [
        {
          id: 'ios-app-store-connect',
          path: 'ios/app-store-connect.env.example',
          operation: 'op-run-env',
          materializer: 'app-store-connect-key',
        },
      ],
    },
    skills: {
      roots: [
        {
          label: '~/.agents/skills',
          path: '$HOME/.agents/skills',
          syncMode: 'inventory-only',
        },
      ],
      install: [],
    },
    mcp: {
      fragments: [
        {
          id: 'private-codex',
          path: 'mcp/codex-mcp.overlay.toml',
          format: 'toml-codex',
          operation: 'managed-block-fragment',
          syncMode: 'install',
        },
      ],
      templates: [
        {
          id: 'op-account',
          path: 'mcp/op-account.env.example',
          operation: 'op-account-select',
        },
        {
          id: 'env-template',
          path: 'mcp/mcp.env.example',
          operation: 'op-run-env',
        },
        {
          id: 'json-op-template',
          path: 'mcp/mcp.op.example.json',
          operation: 'op-inject-template',
          outputPath: 'mcp/mcp.local.json',
        },
      ],
      sources: [
        {
          label: 'Cursor mcp.json',
          path: '$HOME/.cursor/mcp.json',
          format: 'json',
          syncMode: 'inventory-only',
        },
        {
          label: 'Codex config.toml',
          path: '$HOME/.codex/config.toml',
          format: 'toml-codex',
          syncMode: 'inventory-only',
        },
      ],
      ignoredSources: [
        {
          path: '$HOME/.codex/.tmp/plugins/plugins/*/.mcp.json',
          reason: 'plugin-managed temporary config',
        },
      ],
      localOutputs: [
        {
          path: 'mcp/mcp.local.json',
          gitIgnored: true,
          reason: 'may contain resolved tokens',
        },
      ],
    },
  }, null, 2))

  writeFile(path.join(repoRoot, 'mcp', 'op-account.env.example'), [
    'OP_ACCOUNT="TESTACCOUNT"',
    'OP_ITEM_TAGS="Tencent"',
    '',
  ].join('\n'))
  writeFile(path.join(repoRoot, 'mcp', 'mcp.env.example'), [
    'GONGFENG_TOKEN="op://Private/Gongfeng/token"',
    '# optional: only needed for GitHub MCP',
    'GITHUB_PERSONAL_ACCESS_TOKEN="op://Private/GitHub/personal_access_token"',
    '',
  ].join('\n'))
  writeFile(path.join(repoRoot, 'ios', 'app-store-connect.env.example'), [
    'ASC_KEY_ID="op://Private/App Store Connect/key_id"',
    'ASC_ISSUER_ID="op://Private/App Store Connect/issuer_id"',
    'ASC_KEY_P8_CONTENT="op://Private/App Store Connect/private_key"',
    '',
  ].join('\n'))
  writeFile(path.join(repoRoot, 'mcp', 'mcp.op.example.json'), '{"token":"{{ op://Private/Gongfeng/token }}"}\n')
  writeFile(path.join(repoRoot, 'mcp', 'codex-mcp.overlay.toml'), [
    '# Private Codex MCP fragment loaded by workstation.',
    '',
  ].join('\n'))

  return {
    binDir,
    homeRoot,
    manifestPath,
    repoRoot,
  }
}

function testPath(binDir: string): string {
  return `${binDir}${path.delimiter}${process.env.PATH || ''}`
}

function readJsonFile(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

afterEach(() => {
  removePath(tempDir)
  tempDir = undefined
})

describe('private CLI', () => {
  it('keeps private operation validation aligned with the overlay schema', () => {
    const schemaPath = path.resolve(import.meta.dirname, '..', '..', '..', 'schemas', 'private-overlay.schema.json')
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'))
    const schemaOperations = [...schema.$defs.operation.enum].sort()

    assert.deepEqual([...privateAllowedOperations].sort(), schemaOperations)
  })

  it('rejects removed private MCP compatibility operations', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.mcp.fragments[0].operation = 'codex-mcp-fragment'
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runCli(['private', 'apply', '--manifest', fixture.manifestPath, '--dry-run'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1)
    assert.match(`${result.stdout}\n${result.stderr}`, /unsupported MCP fragment operation/)
  })

  it('generates skills and MCP inventory from a private manifest', () => {
    const fixture = createPrivateFixture()
    writeFile(path.join(fixture.homeRoot, '.agents', 'skills', 'alpha', 'SKILL.md'), '# Alpha\n')
    writeFile(path.join(fixture.homeRoot, '.cursor', 'mcp.json'), JSON.stringify({
      mcpServers: {
        beta: {},
        alpha: {},
      },
    }))
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.gongfeng]',
      'command = "node"',
      '',
    ].join('\n'))

    const result = runCli(['private', 'inventory', '--manifest', fixture.manifestPath, '--section', 'all'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /# 本机 Skills \/ MCP 清单/)
    assert.match(result.stdout, /- alpha/)
    assert.match(result.stdout, /- beta/)
    assert.match(result.stdout, /- gongfeng/)
    assert.match(result.stdout, /## 本地输出/)
  })

  it('marks secret references after optional comments as optional', () => {
    const fixture = createPrivateFixture()
    const refs = readSecretReferences(path.join(fixture.repoRoot, 'mcp', 'mcp.env.example'))

    assert.equal(refs.length, 2)
    assert.equal(refs[0].envName, 'GONGFENG_TOKEN')
    assert.equal(refs[0].optional, false)
    assert.equal(refs[1].envName, 'GITHUB_PERSONAL_ACCESS_TOKEN')
    assert.equal(refs[1].optional, true)
  })

  it('does not fail secrets-check when only optional references are missing', () => {
    const fixture = createPrivateFixture()
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const args = process.argv.slice(2)',
      'if (args[0] === "whoami") process.exit(0)',
      'if (args[0] === "read" && args[1].includes("GitHub")) process.exit(1)',
      'if (args[0] === "read") { process.stdout.write("secret"); process.exit(0) }',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'secrets-check', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /ok: op:\/\/Private\/Gongfeng\/token/)
    assert.match(result.stdout, /optional missing, empty, or unreadable/)
  })

  it('checks readable secret references with one op run invocation', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'op-secret-probe-calls.json')
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const { spawnSync } = require("node:child_process")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_OP_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'calls.push(args)',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'if (args[0] === "run") {',
      '  const separator = args.indexOf("--")',
      '  const childEnv = { ...process.env }',
      '  for (const name of Object.keys(childEnv)) {',
      '    if (name.startsWith("WST_OP_SECRET_") && childEnv[name].startsWith("op://")) childEnv[name] = "secret"',
      '  }',
      '  const child = spawnSync(args[separator + 1], args.slice(separator + 2), { encoding: "utf8", env: childEnv })',
      '  process.stdout.write(child.stdout || "")',
      '  process.stderr.write(child.stderr || "")',
      '  process.exit(child.status ?? 1)',
      '}',
      'if (args[0] === "read") process.exit(97)',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'secrets-check', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      FAKE_OP_CALLS: callsPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const calls = readJsonFile(callsPath)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'run')
  })

  it('uses a readable secret reference as the private check 1Password probe', () => {
    const fixture = createPrivateFixture()
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const args = process.argv.slice(2)',
      'if (args[0] === "whoami") process.exit(1)',
      'if (args[0] === "read") { process.stdout.write("secret"); process.exit(0) }',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'check', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /\[ok\] 1Password CLI is available and signed in/)
  })

  it('keeps private status passive when 1Password CLI is installed', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'unexpected-op-call')
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'fs.writeFileSync(process.env.FAKE_OP_CALLS, "called")',
      'process.exit(1)',
    ])

    for (const args of [
      ['private', '--manifest', fixture.manifestPath],
      ['private', 'status', '--manifest', fixture.manifestPath],
    ]) {
      const result = runCli(args, fixture.repoRoot, fixture.homeRoot, {
        FAKE_OP_CALLS: callsPath,
        PATH: testPath(fixture.binDir),
      })

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /\[ok\] 1Password CLI is installed \(authentication not checked\)/)
      assert.equal(fs.existsSync(callsPath), false)
    }
  })

  it('passes manifest env files and commands through mcp-run', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'op-calls.json')
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_OP_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'calls.push(args)',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'if (args[0] === "run" && args[1] === "--")',
      '  process.stdout.write("[true]")',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'mcp-run', '--manifest', fixture.manifestPath, '--', 'node', '-e', 'console.log("ok")'], fixture.repoRoot, fixture.homeRoot, {
      FAKE_OP_CALLS: callsPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const calls = readJsonFile(callsPath)
    assert.deepEqual(calls.at(-1), [
      'run',
      '--env-file',
      path.join(fixture.repoRoot, 'mcp', 'mcp.env.example'),
      '--',
      'node',
      '-e',
      'console.log("ok")',
    ])
  })

  it('omits missing optional secrets from the mcp-run env file', () => {
    const fixture = createPrivateFixture()
    const capturedEnvPath = path.join(fixture.repoRoot, 'captured-mcp.env')
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'if (args[0] === "run" && args[1] === "--") {',
      '  process.stdout.write("[false]")',
      '  process.exit(0)',
      '}',
      'const envFileIndex = args.indexOf("--env-file")',
      'if (envFileIndex !== -1)',
      '  fs.writeFileSync(process.env.FAKE_ENV_CAPTURE, fs.readFileSync(args[envFileIndex + 1], "utf-8"))',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'mcp-run', '--manifest', fixture.manifestPath, '--', 'node', '-e', 'console.log("ok")'], fixture.repoRoot, fixture.homeRoot, {
      FAKE_ENV_CAPTURE: capturedEnvPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const envFile = fs.readFileSync(capturedEnvPath, 'utf8')
    assert.match(envFile, /^GONGFENG_TOKEN=/m)
    assert.doesNotMatch(envFile, /^GITHUB_PERSONAL_ACCESS_TOKEN=/m)
  })

  it('restores declared secret file bundles from 1Password attachments', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.workstationOverlay.allowedOperations.push('op-file-restore')
    manifest.secrets.fileBundles = [
      {
        id: 'wecom-cli',
        operation: 'op-file-restore',
        directoryMode: '0700',
        files: [
          {
            ref: 'op://Private/WeCom CLI/wecom_encryption_key',
            path: '$HOME/.config/wecom/.encryption_key',
            mode: '0600',
          },
          {
            ref: 'op://Private/WeCom CLI/wecom_bot_enc',
            path: '$HOME/.config/wecom/bot.enc',
            mode: '0600',
          },
        ],
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.homeRoot, '.config', 'wecom', 'bot.enc'), 'old-bot')

    const callsPath = path.join(fixture.repoRoot, 'op-file-restore-calls.json')
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_OP_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'calls.push(args)',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'if (args[0] === "read") {',
      '  const outIndex = args.indexOf("--out-file")',
      '  const ref = args[args.length - 1]',
      '  fs.writeFileSync(args[outIndex + 1], "restored:" + ref)',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'file-restore', '--manifest', fixture.manifestPath, '--bundle', 'wecom-cli', '--yes'], fixture.repoRoot, fixture.homeRoot, {
      FAKE_OP_CALLS: callsPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /\[apply\] secret file bundle wecom-cli/)
    assert.match(result.stdout, /\[backup\].*bot\.enc\.backup\./)

    const configDir = path.join(fixture.homeRoot, '.config', 'wecom')
    assert.equal(fs.statSync(configDir).mode & 0o777, 0o700)
    assert.equal(fs.statSync(path.join(configDir, '.encryption_key')).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.join(configDir, 'bot.enc')).mode & 0o777, 0o600)
    assert.equal(fs.readFileSync(path.join(configDir, 'bot.enc'), 'utf8'), 'restored:op://Private/WeCom CLI/wecom_bot_enc')
    assert.ok(fs.readdirSync(configDir).some(entry => entry.startsWith('bot.enc.backup.')))

    const calls = readJsonFile(callsPath)
    assert.equal(calls.filter((call: string[]) => call[0] === 'read').length, 2)
  })

  it('remembers connected private manifests for later commands', () => {
    const fixture = createPrivateFixture()
    fs.mkdirSync(path.join(fixture.repoRoot, '.git'))
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'process.exit(1)',
    ])

    const connectResult = runCli([
      'private',
      'connect',
      '--repo',
      'git@example.com:user/dotfiles.git',
      '--target-dir',
      fixture.repoRoot,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot, {
      PATH: testPath(fixture.binDir),
    })

    assert.equal(connectResult.status, 0, `${connectResult.stdout}\n${connectResult.stderr}`)
    assert.match(connectResult.stdout, /\[ok\] default private manifest saved/)

    const configPath = path.join(fixture.homeRoot, '.config', 'workstation', 'private.json')
    const config = readJsonFile(configPath)
    assert.equal(config.manifestPath, fixture.manifestPath)
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600)

    const listResult = runCli(['private', 'list'], fixture.repoRoot, fixture.homeRoot)
    assert.equal(listResult.status, 0, `${listResult.stdout}\n${listResult.stderr}`)
    assert.match(listResult.stdout, new RegExp(escapeRegExp(`Manifest: ${fixture.manifestPath}`)))
  })

  it('discovers dotfiles manifests under ~/repos when no manifest is configured', () => {
    const fixture = createPrivateFixture()
    const discoveredRepo = path.join(fixture.homeRoot, 'repos', 'woa', 'demo', 'dotfiles')
    fs.cpSync(fixture.repoRoot, discoveredRepo, { recursive: true })

    const result = runCli(['private', 'list'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, new RegExp(escapeRegExp(`Manifest: ${path.join(discoveredRepo, 'config', 'sync-manifest.json')}`)))
  })

  it('applies private Skills and Codex MCP without pnpm or public install scripts', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.mcp.templates = []
    manifest.secrets.envTemplates = []
    manifest.skills.install = [
      {
        id: 'private-review',
        targetName: 'private-review',
        description: 'Private review workflow.',
        source: {
          type: 'local',
          path: 'skills/install/private-review',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-review', 'SKILL.md'), '# Private review\n')
    writeFile(path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml'), [
      '[mcp_servers.private_docs]',
      'url = "https://docs.example.com/mcp"',
      '',
    ].join('\n'))

    const result = runCli(['private', 'apply', '--manifest', fixture.manifestPath, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(
      fs.readFileSync(path.join(fixture.homeRoot, '.codex', 'skills', 'private-review', 'SKILL.md'), 'utf-8'),
      '# Private review\n',
    )
    const codexConfig = fs.readFileSync(path.join(fixture.homeRoot, '.codex', 'config.toml'), 'utf-8')
    assert.match(codexConfig, /# >>> workstation managed private mcp/)
    assert.match(codexConfig, /\[mcp_servers\.private_docs\]/)
  })

  it('applies only the Codex MCP managed block with mcp-apply', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'private-review',
        targetName: 'private-review',
        description: 'Private review workflow.',
        source: {
          type: 'local',
          path: 'skills/install/private-review',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-review', 'SKILL.md'), '# Private review\n')
    writeFile(path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml'), [
      '[mcp_servers.private_docs]',
      'url = "https://docs.example.com/mcp"',
      '',
    ].join('\n'))

    const result = runCli([
      'private',
      'mcp-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.existsSync(path.join(fixture.repoRoot, 'mcp', 'mcp.local.json')), false)
    assert.equal(fs.existsSync(path.join(fixture.homeRoot, '.codex', 'skills', 'private-review')), false)
    const codexConfig = fs.readFileSync(path.join(fixture.homeRoot, '.codex', 'config.toml'), 'utf-8')
    assert.match(codexConfig, /\[mcp_servers\.private_docs\]/)
  })

  it('resolves private MCP repository placeholders from the connected manifest', () => {
    const fixture = createPrivateFixture()
    writeFile(path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml'), [
      '[mcp_servers.private_wrapper]',
      'command = "{{WORKSTATION_PRIVATE_REPO_ROOT}}/mcp/bin/private-wrapper"',
      '',
    ].join('\n'))

    const result = runCli([
      'private',
      'mcp-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const codexConfig = fs.readFileSync(path.join(fixture.homeRoot, '.codex', 'config.toml'), 'utf8')
    assert.match(codexConfig, new RegExp(escapeRegExp(`command = "${fixture.repoRoot}/mcp/bin/private-wrapper"`)))
    assert.doesNotMatch(codexConfig, /WORKSTATION_PRIVATE_REPO_ROOT/)
  })

  it('applies only private Skill installs and invocation policies with skills-apply', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.explicitOnly = {
      codex: ['codex-skill'],
      shared: ['shared-skill'],
    }
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const sharedConfig = path.join(fixture.homeRoot, '.agents', 'skills', 'shared-skill', 'agents', 'openai.yaml')
    const codexConfig = path.join(fixture.homeRoot, '.codex', 'skills', 'codex-skill', 'agents', 'openai.yaml')
    writeFile(path.join(fixture.homeRoot, '.agents', 'skills', 'shared-skill', 'SKILL.md'), '# Shared\n')
    writeFile(sharedConfig, 'interface:\n  display_name: "Shared"\n')
    writeFile(path.join(fixture.homeRoot, '.codex', 'skills', 'codex-skill', 'SKILL.md'), '# Codex\n')

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(fs.readFileSync(sharedConfig, 'utf8'), /display_name: "?Shared"?/)
    assert.match(fs.readFileSync(sharedConfig, 'utf8'), /allow_implicit_invocation: false/)
    assert.match(fs.readFileSync(codexConfig, 'utf8'), /allow_implicit_invocation: false/)
    assert.equal(fs.existsSync(path.join(fixture.repoRoot, 'mcp', 'mcp.local.json')), false)
    assert.equal(fs.existsSync(path.join(fixture.homeRoot, '.codex', 'config.toml')), false)
  })

  it('installs shared private Skills with auditable provenance', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'private-shared',
        targetName: 'private-shared',
        root: 'shared',
        description: 'Private shared workflow.',
        source: {
          type: 'local',
          path: 'skills/install/private-shared',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-shared', 'SKILL.md'), [
      '---',
      'name: private-shared',
      'description: Private shared workflow.',
      '---',
      '',
      '# Private shared',
      '',
    ].join('\n'))

    const apply = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(apply.status, 0, `${apply.stdout}\n${apply.stderr}`)
    assert.equal(
      fs.existsSync(path.join(fixture.homeRoot, '.agents', 'skills', 'private-shared', 'SKILL.md')),
      true,
    )
    const lockPath = path.join(fixture.homeRoot, '.agents', '.wst-skill-lock.json')
    const lock = readJsonFile(lockPath)
    assert.equal(lock.version, 1)
    assert.equal(lock.skills['private-shared'].root, 'shared')
    assert.match(lock.skills['private-shared'].digest, /^sha256:[a-f0-9]{64}$/)

    const audit = runCli([
      'skills',
      'audit',
      '--project-root',
      fixture.repoRoot,
      '--check',
      '--json',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(audit.status, 0, `${audit.stdout}\n${audit.stderr}`)
    const report = JSON.parse(audit.stdout)
    assert.equal(report.workstation.lockExists, true)
    assert.equal(report.workstation.managedSkillCount, 1)
    assert.equal(report.summary.unmanagedSharedSkillCount, 0)
    assert.equal(report.summary.errorCount, 0)
  })

  it('detects modified workstation-managed private Skills', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'private-shared',
        targetName: 'private-shared',
        root: 'shared',
        description: 'Private shared workflow.',
        source: {
          type: 'local',
          path: 'skills/install/private-shared',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const source = path.join(fixture.repoRoot, 'skills', 'install', 'private-shared', 'SKILL.md')
    writeFile(source, [
      '---',
      'name: private-shared',
      'description: Private shared workflow.',
      '---',
      '',
      '# Private shared',
      '',
    ].join('\n'))
    const apply = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)
    assert.equal(apply.status, 0, `${apply.stdout}\n${apply.stderr}`)
    writeFile(
      path.join(fixture.homeRoot, '.agents', 'skills', 'private-shared', 'SKILL.md'),
      `${fs.readFileSync(source, 'utf8')}modified\n`,
    )

    const audit = runCli([
      'skills',
      'audit',
      '--project-root',
      fixture.repoRoot,
      '--check',
      '--json',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(audit.status, 1, `${audit.stdout}\n${audit.stderr}`)
    const report = JSON.parse(audit.stdout)
    assert.equal(report.findings.some((finding: { code: string }) => finding.code === 'modified-workstation-skill'), true)
  })

  it('rejects duplicate private Skill names across install roots', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'private-shared',
        targetName: 'duplicate-name',
        root: 'shared',
        description: 'Private shared workflow.',
        source: {
          type: 'local',
          path: 'skills/install/private-shared',
        },
      },
      {
        id: 'private-codex',
        targetName: 'duplicate-name',
        root: 'codex',
        description: 'Private Codex workflow.',
        source: {
          type: 'local',
          path: 'skills/install/private-codex',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-shared', 'SKILL.md'), '# Shared\n')
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-codex', 'SKILL.md'), '# Codex\n')

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--dry-run',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /Duplicate private skill name: duplicate-name/)
  })

  it('does not mutate private Skills when the existing provenance lock is invalid', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [{
      id: 'private-shared',
      targetName: 'private-shared',
      root: 'shared',
      description: 'Private shared workflow.',
      source: {
        type: 'local',
        path: 'skills/install/private-shared',
      },
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-shared', 'SKILL.md'), '# New\n')
    const destination = path.join(fixture.homeRoot, '.agents', 'skills', 'private-shared', 'SKILL.md')
    writeFile(destination, '# Existing\n')
    writeFile(
      path.join(fixture.homeRoot, '.agents', '.wst-skill-lock.json'),
      `${JSON.stringify({ skills: {}, version: 2 }, null, 2)}\n`,
    )

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /provenance lock is invalid/)
    assert.equal(fs.readFileSync(destination, 'utf8'), '# Existing\n')
  })

  it.runIf(process.platform !== 'win32')('validates every local private Skill before replacing any target', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'first',
        root: 'shared',
        description: 'First private workflow.',
        source: {
          type: 'local',
          path: 'skills/install/first',
        },
      },
      {
        id: 'second',
        root: 'shared',
        description: 'Second private workflow.',
        source: {
          type: 'local',
          path: 'skills/install/second',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'first', 'SKILL.md'), '# New\n')
    const firstDestination = path.join(fixture.homeRoot, '.agents', 'skills', 'first', 'SKILL.md')
    writeFile(firstDestination, '# Existing\n')
    const secondSource = path.join(fixture.repoRoot, 'skills', 'install', 'second')
    writeFile(path.join(secondSource, 'SKILL.md'), '# Second\n')
    const outside = path.join(tempDir!, 'outside-file')
    writeFile(outside, 'outside\n')
    fs.symlinkSync(outside, path.join(secondSource, 'linked-file'))

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /must not contain symbolic links/)
    assert.equal(fs.readFileSync(firstDestination, 'utf8'), '# Existing\n')
  })

  it('validates every private Skill policy before replacing install targets', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [{
      id: 'private-shared',
      root: 'shared',
      description: 'Private shared workflow.',
      source: {
        type: 'local',
        path: 'skills/install/private-shared',
      },
    }]
    manifest.skills.policies = [{
      id: 'broken-policy',
      root: 'shared',
      path: 'existing-skill',
      allowImplicitInvocation: false,
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-shared', 'SKILL.md'), '# New\n')
    const destination = path.join(fixture.homeRoot, '.agents', 'skills', 'private-shared', 'SKILL.md')
    writeFile(destination, '# Existing\n')
    writeFile(path.join(fixture.homeRoot, '.agents', 'skills', 'existing-skill', 'SKILL.md'), '# Existing Skill\n')
    writeFile(path.join(fixture.homeRoot, '.agents', 'skills', 'existing-skill', 'agents', 'openai.yaml'), 'policy: [\n')

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /agents\/openai.yaml is invalid/)
    assert.equal(fs.readFileSync(destination, 'utf8'), '# Existing\n')
  })

  it('materializes every GitHub private Skill before replacing local targets', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'local-first',
        root: 'shared',
        description: 'Local private workflow.',
        source: {
          type: 'local',
          path: 'skills/install/local-first',
        },
      },
      {
        id: 'github-second',
        root: 'shared',
        description: 'GitHub private workflow.',
        source: {
          type: 'github',
          repo: 'owner/private-skill',
          path: 'skills/github-second',
          ref: 'main',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'local-first', 'SKILL.md'), '# New\n')
    const destination = path.join(fixture.homeRoot, '.agents', 'skills', 'local-first', 'SKILL.md')
    writeFile(destination, '# Existing\n')
    writeExecutable(path.join(fixture.binDir, 'git'), [
      'process.stderr.write("simulated clone failure\\n");',
      'process.exit(1);',
    ])

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot, {
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /simulated clone failure/)
    assert.equal(fs.readFileSync(destination, 'utf8'), '# Existing\n')
  })

  it('keeps installed private Skills idempotent when a policy augments their source', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [{
      id: 'private-shared',
      root: 'shared',
      description: 'Private shared workflow.',
      source: {
        type: 'local',
        path: 'skills/install/private-shared',
      },
    }]
    manifest.skills.policies = [{
      id: 'private-shared-explicit',
      root: 'shared',
      path: 'private-shared',
      allowImplicitInvocation: false,
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-shared', 'SKILL.md'), '# Private\n')

    const first = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)
    const second = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.match(second.stdout, /\[skip\] private skill private-shared is already up to date/)
    assert.match(second.stdout, /\[skip\] private Skill policy private-shared-explicit is already up to date/)
    assert.doesNotMatch(second.stdout, /\[ok\] installed private skill/)
  })

  it('previews install-bound private Skill policies on a clean home', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [{
      id: 'private-shared',
      root: 'shared',
      description: 'Private shared workflow.',
      source: {
        type: 'local',
        path: 'skills/install/private-shared',
      },
    }]
    manifest.skills.policies = [{
      id: 'private-shared-explicit',
      root: 'shared',
      path: 'private-shared',
      allowImplicitInvocation: false,
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'private-shared', 'SKILL.md'), '# Private\n')

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--dry-run',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /\[dry-run\] private skill private-shared/)
    assert.match(result.stdout, /\[dry-run\] private Skill policy private-shared-explicit/)
    assert.equal(fs.existsSync(path.join(fixture.homeRoot, '.agents', 'skills', 'private-shared')), false)
  })

  it.runIf(process.platform !== 'win32')('rejects local private Skill sources that escape through a symbolic link', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'linked-source',
        root: 'shared',
        description: 'Linked private workflow.',
        source: {
          type: 'local',
          path: 'skills/install/linked-source',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const outside = path.join(tempDir!, 'outside-skill')
    writeFile(path.join(outside, 'SKILL.md'), '# Outside\n')
    const source = path.join(fixture.repoRoot, 'skills', 'install', 'linked-source')
    fs.mkdirSync(path.dirname(source), { recursive: true })
    fs.symlinkSync(outside, source)

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--dry-run',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /escapes private overlay repository|must be a real directory/)
  })

  it.runIf(process.platform !== 'win32')('refuses to replace a private Skill destination symbolic link', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [
      {
        id: 'linked-destination',
        root: 'shared',
        description: 'Linked private workflow.',
        source: {
          type: 'local',
          path: 'skills/install/linked-destination',
        },
      },
    ]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'linked-destination', 'SKILL.md'), '# Source\n')
    const outside = path.join(tempDir!, 'outside-destination')
    writeFile(path.join(outside, 'SKILL.md'), '# Outside\n')
    const destination = path.join(fixture.homeRoot, '.agents', 'skills', 'linked-destination')
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.symlinkSync(outside, destination)

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /destination must be a real directory/)
    assert.equal(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf8'), '# Outside\n')
  })

  it.runIf(process.platform !== 'win32')('refuses to replace a broken private Skill destination symbolic link', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.install = [{
      id: 'broken-destination',
      root: 'shared',
      description: 'Broken destination workflow.',
      source: {
        type: 'local',
        path: 'skills/install/broken-destination',
      },
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'skills', 'install', 'broken-destination', 'SKILL.md'), '# Source\n')
    const destination = path.join(fixture.homeRoot, '.agents', 'skills', 'broken-destination')
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.symlinkSync(path.join(tempDir!, 'missing-destination'), destination)

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /destination must be a real directory/)
    assert.equal(fs.lstatSync(destination).isSymbolicLink(), true)
  })

  it.runIf(process.platform !== 'win32')('rejects private Skill policy targets that escape through a symbolic link', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.policies = [{
      id: 'linked-policy',
      root: 'shared',
      path: 'linked-policy',
      allowImplicitInvocation: false,
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const outside = path.join(tempDir!, 'outside-policy')
    writeFile(path.join(outside, 'SKILL.md'), '# Outside\n')
    const outsideConfig = path.join(outside, 'agents', 'openai.yaml')
    writeFile(outsideConfig, 'interface:\n  display_name: Outside\n')
    const linked = path.join(fixture.homeRoot, '.agents', 'skills', 'linked-policy')
    fs.mkdirSync(path.dirname(linked), { recursive: true })
    fs.symlinkSync(outside, linked)

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /escapes its discovery root/)
    assert.equal(fs.readFileSync(outsideConfig, 'utf8'), 'interface:\n  display_name: Outside\n')
  })

  it.runIf(process.platform !== 'win32')('rejects broken agents/openai.yaml policy symbolic links', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.policies = [{
      id: 'broken-config-link',
      root: 'shared',
      path: 'linked-config',
      allowImplicitInvocation: false,
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const skillDirectory = path.join(fixture.homeRoot, '.agents', 'skills', 'linked-config')
    writeFile(path.join(skillDirectory, 'SKILL.md'), '# Linked Config\n')
    const configPath = path.join(skillDirectory, 'agents', 'openai.yaml')
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.symlinkSync(path.join(tempDir!, 'missing-config.yaml'), configPath)

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /agents\/openai.yaml must not be a symbolic link/)
    assert.equal(fs.lstatSync(configPath).isSymbolicLink(), true)
  })

  it('rejects private Skill policy paths that escape their discovery root', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.policies = [{
      id: 'unsafe',
      root: 'shared',
      path: '../escape',
      allowImplicitInvocation: false,
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--dry-run',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /unsafe Skill policy path/)
  })

  it('validates existing agents/openai.yaml during a Skill policy dry-run', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.skills.policies = [{
      id: 'broken-config',
      root: 'shared',
      path: 'broken-config',
      allowImplicitInvocation: false,
    }]
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const skillRoot = path.join(fixture.homeRoot, '.agents', 'skills', 'broken-config')
    writeFile(path.join(skillRoot, 'SKILL.md'), '# Broken config\n')
    writeFile(path.join(skillRoot, 'agents', 'openai.yaml'), 'policy: [\n')

    const result = runCli([
      'private',
      'skills-apply',
      '--manifest',
      fixture.manifestPath,
      '--dry-run',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /agents\/openai.yaml is invalid/)
  })

  it('removes the managed private MCP block when no fragments remain', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.mcp.fragments = []
    manifest.mcp.templates = []
    manifest.secrets.envTemplates = []
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      'model = "gpt-5"',
      '',
      '# >>> workstation managed private mcp',
      '[mcp_servers.private_docs]',
      'url = "https://docs.example.com/mcp"',
      '# <<< workstation managed private mcp',
      '',
    ].join('\n'))

    const result = runCli(['private', 'apply', '--manifest', fixture.manifestPath, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(
      fs.readFileSync(path.join(fixture.homeRoot, '.codex', 'config.toml'), 'utf-8'),
      'model = "gpt-5"\n',
    )
  })

  it('adopts an unmanaged private MCP section that is a subset of the desired section', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.mcp.templates = []
    manifest.secrets.envTemplates = []
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml'), [
      '[mcp_servers.private_docs]',
      'url = "https://docs.example.com/mcp"',
      'tool_timeout_sec = 60',
      '',
    ].join('\n'))
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      'model = "gpt-5"',
      '',
      '[mcp_servers.private_docs]',
      'url = "https://docs.example.com/mcp"',
      '',
    ].join('\n'))

    const result = runCli(['private', 'apply', '--manifest', fixture.manifestPath, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const codexConfig = fs.readFileSync(path.join(fixture.homeRoot, '.codex', 'config.toml'), 'utf-8')
    assert.equal(codexConfig.match(/\[mcp_servers\.private_docs\]/g)?.length, 1)
    assert.match(codexConfig, /# >>> workstation managed private mcp/)
    assert.match(codexConfig, /tool_timeout_sec = 60/)
  })

  it('refuses to adopt a conflicting unmanaged private MCP section', () => {
    const fixture = createPrivateFixture()
    const manifest = readJsonFile(fixture.manifestPath)
    manifest.mcp.templates = []
    manifest.secrets.envTemplates = []
    writeFile(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFile(path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml'), [
      '[mcp_servers.private_docs]',
      'url = "https://desired.example.com/mcp"',
      '',
    ].join('\n'))
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.private_docs]',
      'url = "https://different.example.com/mcp"',
      '',
    ].join('\n'))

    const result = runCli(['private', 'apply', '--manifest', fixture.manifestPath, '--yes'], fixture.repoRoot, fixture.homeRoot, {
      PATH: fixture.binDir,
    })

    assert.equal(result.status, 1)
    assert.match(`${result.stdout}\n${result.stderr}`, /already exist with different content/)
  })

  it('runs iOS commands with materialized App Store Connect key files', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'op-ios-run-calls.json')
    const outputPath = path.join(fixture.repoRoot, 'ios-run-output.json')
    const expectedKeyPath = path.join(fixture.homeRoot, '.appstoreconnect', 'private_keys', 'AuthKey_KEY123.p8')
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const { spawnSync } = require("node:child_process")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_OP_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'calls.push(args)',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'if (args[0] === "run") {',
      '  const separator = args.indexOf("--")',
      '  const childEnv = { ...process.env }',
      '  childEnv.ASC_KEY_ID = "KEY123"',
      '  childEnv.ASC_ISSUER_ID = "ISSUER456"',
      '  childEnv.ASC_KEY_P8_CONTENT = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"',
      '  const child = spawnSync(args[separator + 1], args.slice(separator + 2), { encoding: "utf8", env: childEnv })',
      '  process.stdout.write(child.stdout || "")',
      '  process.stderr.write(child.stderr || "")',
      '  process.exit(child.status ?? 1)',
      '}',
      'if (args[0] === "read") process.exit(97)',
      'process.exit(0)',
    ])

    const result = runCli([
      'private',
      'ios-run',
      '--manifest',
      fixture.manifestPath,
      '--',
      process.execPath,
      '-e',
      [
        'const fs = require("node:fs")',
        'const output = {',
        'keyId: process.env.ASC_KEY_ID,',
        'issuerId: process.env.ASC_ISSUER_ID,',
        'keyPath: process.env.ASC_KEY_P8,',
        'hasInlineKey: Boolean(process.env.ASC_KEY_P8_CONTENT),',
        'keyContent: fs.readFileSync(process.env.ASC_KEY_P8, "utf8")',
        '}',
        'fs.writeFileSync(process.env.OUT, JSON.stringify(output))',
      ].join('\n'),
    ], fixture.repoRoot, fixture.homeRoot, {
      FAKE_OP_CALLS: callsPath,
      OUT: outputPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const output = readJsonFile(outputPath)
    assert.equal(output.keyId, 'KEY123')
    assert.equal(output.issuerId, 'ISSUER456')
    assert.equal(output.keyPath, expectedKeyPath)
    assert.equal(output.hasInlineKey, false)
    assert.match(output.keyContent, /BEGIN PRIVATE KEY/)
    assert.equal(fs.statSync(expectedKeyPath).mode & 0o777, 0o600)
    const calls = readJsonFile(callsPath)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'run')
  })

  it('imports App Store Connect credentials into one 1Password item', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'op-ios-import-calls.json')
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_OP_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'const templateIndex = args.indexOf("--template")',
      'calls.push({ args, template: templateIndex === -1 ? undefined : JSON.parse(fs.readFileSync(args[templateIndex + 1], "utf-8")) })',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'if (args[0] === "item" && args[1] === "get") process.exit(1)',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'ios-secrets-import', '--yes', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      ASC_ISSUER_ID: 'ISSUER456',
      ASC_KEY_ID: 'KEY123',
      ASC_KEY_P8_CONTENT: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      FAKE_OP_CALLS: callsPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /created: op:\/\/Private\/App Store Connect\/\{key_id,issuer_id,private_key\}/)
    const calls = readJsonFile(callsPath)
    const createCall = calls.find((call: { args: string[] }) => call.args[0] === 'item' && call.args[1] === 'create')
    assert.ok(createCall)
    assert.equal(createCall.template.title, 'App Store Connect')
    assert.equal(createCall.template.fields.find((field: { label: string }) => field.label === 'key_id')?.value, 'KEY123')
    assert.equal(createCall.template.fields.find((field: { label: string }) => field.label === 'issuer_id')?.value, 'ISSUER456')
    assert.match(createCall.template.fields.find((field: { label: string }) => field.label === 'private_key')?.value, /BEGIN PRIVATE KEY/)
  })

  it('imports MCP header secrets from Codex config using exported env names', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'op-mcp-import-calls.json')
    writeFile(path.join(fixture.repoRoot, 'mcp', 'mcp.env.example'), [
      'KNOT_X_KNOT_API_TOKEN="op://Private/Knot/x_knot_api_token"',
      '',
    ].join('\n'))
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.knot.http_headers]',
      'x-knot-api-token = "knot-token-value"',
      '',
    ].join('\n'))
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_OP_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'const templateIndex = args.indexOf("--template")',
      'calls.push({ args, template: templateIndex === -1 ? undefined : JSON.parse(fs.readFileSync(args[templateIndex + 1], "utf-8")) })',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'if (args[0] === "item" && args[1] === "get") process.exit(1)',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'secrets-import', '--yes', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      CODEX_CONFIG_FILE: path.join(fixture.homeRoot, '.codex', 'config.toml'),
      FAKE_OP_CALLS: callsPath,
      KNOT_X_KNOT_API_TOKEN: '',
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /created: op:\/\/Private\/Knot\/x_knot_api_token/)
    const calls = readJsonFile(callsPath)
    const createCall = calls.find((call: { args: string[] }) => call.args[0] === 'item' && call.args[1] === 'create')
    assert.ok(createCall)
    assert.equal(createCall.template.title, 'Knot')
    assert.equal(createCall.template.fields.find((field: { label: string }) => field.label === 'x_knot_api_token')?.value, 'knot-token-value')
  })

  it('imports bearer_token_env_var literal values from Codex config using exported env names', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'op-mcp-bearer-import-calls.json')
    writeFile(path.join(fixture.repoRoot, 'mcp', 'mcp.env.example'), [
      'KM_TOKEN="op://Private/KM/token"',
      '',
    ].join('\n'))
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.km]',
      'url = "https://km.example.com/mcp"',
      'bearer_token_env_var = "km-token-value"',
      '',
    ].join('\n'))
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_OP_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'const templateIndex = args.indexOf("--template")',
      'calls.push({ args, template: templateIndex === -1 ? undefined : JSON.parse(fs.readFileSync(args[templateIndex + 1], "utf-8")) })',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'if (args[0] === "item" && args[1] === "get") process.exit(1)',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'secrets-import', '--yes', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      CODEX_CONFIG_FILE: path.join(fixture.homeRoot, '.codex', 'config.toml'),
      FAKE_OP_CALLS: callsPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /created: op:\/\/Private\/KM\/token/)
    const calls = readJsonFile(callsPath)
    const createCall = calls.find((call: { args: string[] }) => call.args[0] === 'item' && call.args[1] === 'create')
    assert.ok(createCall)
    assert.equal(createCall.template.title, 'KM')
    assert.equal(createCall.template.fields.find((field: { label: string }) => field.label === 'token')?.value, 'km-token-value')
  })

  it('previews MCP template injection by default', () => {
    const fixture = createPrivateFixture()
    const outputPath = path.join(fixture.repoRoot, 'mcp', 'mcp.local.json')

    const result = runCli(['private', 'mcp-inject', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /\[dry-run\] op inject/)
    assert.equal(fs.existsSync(outputPath), false)
  })

  it('omits MCP JSON servers with missing optional 1Password references during injection', () => {
    const fixture = createPrivateFixture()
    const outputPath = path.join(fixture.repoRoot, 'mcp', 'mcp.local.json')
    writeFile(path.join(fixture.repoRoot, 'mcp', 'mcp.op.example.json'), JSON.stringify({
      mcpServers: {
        gongfeng: {
          command: 'gongfeng-mcp',
          env: {
            GONGFENG_TOKEN: '{{ op://Private/Gongfeng/token }}',
          },
        },
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: '{{ op://Private/GitHub/personal_access_token }}',
          },
        },
      },
    }, null, 2))
    writeExecutable(path.join(fixture.binDir, 'op'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'if (args[0] === "read" && args[1].includes("GitHub")) process.exit(1)',
      'if (args[0] === "read") { process.stdout.write("secret"); process.exit(0) }',
      'if (args[0] === "inject") {',
      '  const input = args[args.indexOf("--in-file") + 1]',
      '  const output = args[args.indexOf("--out-file") + 1]',
      '  const template = fs.readFileSync(input, "utf8")',
      '  if (template.includes("GitHub")) process.exit(2)',
      '  fs.writeFileSync(output, template.replace(/\\{\\{ op:\\/\\/Private\\/Gongfeng\\/token \\}\\}/g, "gongfeng-secret"))',
      '  process.exit(0)',
      '}',
      'process.exit(0)',
    ])

    const result = runCli(['private', 'mcp-inject', '--yes', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      PATH: testPath(fixture.binDir),
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /omitted 1 optional MCP server/)
    const output = readJsonFile(outputPath)
    assert.deepEqual(Object.keys(output.mcpServers), ['gongfeng'])
    assert.equal(output.mcpServers.gongfeng.env.GONGFENG_TOKEN, 'gongfeng-secret')
  })

  it('previews selected Codex MCP server export by default without leaking env values', () => {
    const fixture = createPrivateFixture()
    const overlayPath = path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml')
    const originalOverlay = fs.readFileSync(overlayPath, 'utf-8')
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.gongfeng]',
      'command = "gongfeng-mcp"',
      'args = ["serve"]',
      'env = { GONGFENG_TOKEN = "real-token-value" }',
      '',
      '[mcp_servers.iwiki]',
      'url = "https://iwiki.example.com/mcp"',
      `http_headers = { Authorization = "$${'{IWIKI_AUTHORIZATION}'}" }`,
      '',
      '[mcp_servers.other]',
      'command = "other-mcp"',
      '',
    ].join('\n'))

    const result = runCli(['private', 'mcp-export', '--manifest', fixture.manifestPath, '--server', 'gongfeng,iwiki'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /\[dry-run\] export MCP servers gongfeng, iwiki/)
    assert.match(result.stdout, /\[mcp_servers\.gongfeng\]/)
    assert.match(result.stdout, /GONGFENG_TOKEN = "\$\{GONGFENG_TOKEN\}"/)
    assert.doesNotMatch(result.stdout, /real-token-value/)
    assert.doesNotMatch(result.stdout, /\[mcp_servers\.other\]/)
    assert.equal(fs.readFileSync(overlayPath, 'utf-8'), originalOverlay)
  })

  it('writes selected Codex MCP servers to the private overlay when confirmed', () => {
    const fixture = createPrivateFixture()
    const overlayPath = path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml')
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.gongfeng]',
      'command = "gongfeng-mcp"',
      'args = ["serve"]',
      'env = { GONGFENG_TOKEN = "real-token-value" }',
      '',
      '[mcp_servers.knot]',
      'command = "knot-mcp"',
      'args = ["--stdio"]',
      '',
    ].join('\n'))

    const result = runCli(['private', 'mcp-export', '--manifest', fixture.manifestPath, '--server', 'gongfeng,knot', '--yes'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /\[export\] wrote MCP overlay/)
    const overlay = fs.readFileSync(overlayPath, 'utf-8')
    assert.match(overlay, /# Exported by `wst private mcp-export`/)
    assert.match(overlay, /\[mcp_servers\.gongfeng\]/)
    assert.match(overlay, /GONGFENG_TOKEN = "\$\{GONGFENG_TOKEN\}"/)
    assert.match(overlay, /\[mcp_servers\.knot\]/)
    assert.doesNotMatch(overlay, /real-token-value/)
  })

  it('keeps non-secret env values and env_http_headers variable names while exporting', () => {
    const fixture = createPrivateFixture()
    const overlayPath = path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml')
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.cloudbase]',
      'command = "cloudbase-mcp"',
      '',
      '[mcp_servers.cloudbase.env]',
      'INTEGRATION_IDE = "CodeX"',
      'API_TOKEN = "real-token-value"',
      '',
      '[mcp_servers.tencent-docs]',
      'url = "https://docs.qq.com/openapi/mcp"',
      '',
      '[mcp_servers.tencent-docs.env_http_headers]',
      'Authorization = "TENCENT_DOCS_TOKEN"',
      '',
      '[mcp_servers.km]',
      'url = "https://km.example.com/mcp"',
      'bearer_token_env_var = "real-token-value"',
      '',
    ].join('\n'))

    const result = runCli(['private', 'mcp-export', '--manifest', fixture.manifestPath, '--server', 'cloudbase,tencent-docs,km', '--yes'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const overlay = fs.readFileSync(overlayPath, 'utf-8')
    assert.match(overlay, /INTEGRATION_IDE = "CodeX"/)
    assert.match(overlay, /API_TOKEN = "\$\{CLOUDBASE_API_TOKEN\}"/)
    assert.match(overlay, /Authorization = "TENCENT_DOCS_TOKEN"/)
    assert.match(overlay, /bearer_token_env_var = "KM_TOKEN"/)
    assert.doesNotMatch(overlay, /real-token-value/)
  })

  it('fails MCP export when a requested Codex server is missing', () => {
    const fixture = createPrivateFixture()
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.gongfeng]',
      'command = "gongfeng-mcp"',
      '',
    ].join('\n'))

    const result = runCli(['private', 'mcp-export', '--manifest', fixture.manifestPath, '--server', 'iwiki'], fixture.repoRoot, fixture.homeRoot)

    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /Requested MCP server was not found: iwiki/)
  })

  it('sanitizes literal header secrets when exporting selected servers', () => {
    const fixture = createPrivateFixture()
    const overlayPath = path.join(fixture.repoRoot, 'mcp', 'codex-mcp.overlay.toml')
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.iwiki]',
      'url = "https://iwiki.example.com/mcp"',
      'http_headers = { Authorization = "Bearer real-token-value" }',
      '',
    ].join('\n'))

    const result = runCli(['private', 'mcp-export', '--manifest', fixture.manifestPath, '--server', 'iwiki', '--yes'], fixture.repoRoot, fixture.homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const overlay = fs.readFileSync(overlayPath, 'utf-8')
    assert.match(overlay, /Authorization = "Bearer \$\{IWIKI_TOKEN\}"/)
    assert.doesNotMatch(overlay, /real-token-value/)
  })

  it('refuses MCP export when selected servers pass literal secrets through args', () => {
    const fixture = createPrivateFixture()
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.gongfeng]',
      'command = "gongfeng-mcp"',
      'args = ["--token", "real-token-value"]',
      '',
    ].join('\n'))

    const result = runCli(['private', 'mcp-export', '--manifest', fixture.manifestPath, '--server', 'gongfeng'], fixture.repoRoot, fixture.homeRoot)

    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /Refusing to export literal secret-like value/)
  })

  it('refuses MCP export output paths that are not declared fragments', () => {
    const fixture = createPrivateFixture()
    const unexpectedOutput = path.join(fixture.repoRoot, 'mcp', 'other.toml')
    writeFile(path.join(fixture.homeRoot, '.codex', 'config.toml'), [
      '[mcp_servers.gongfeng]',
      'command = "gongfeng-mcp"',
      '',
    ].join('\n'))

    const result = runCli([
      'private',
      'mcp-export',
      '--manifest',
      fixture.manifestPath,
      '--server',
      'gongfeng',
      '--output',
      'mcp/other.toml',
      '--yes',
    ], fixture.repoRoot, fixture.homeRoot)

    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}\n${result.stderr}`, /Output path is not a declared MCP fragment/)
    assert.equal(fs.existsSync(unexpectedOutput), false)
  })

  it('selects the expected gitleaks mode for secret scans', () => {
    const fixture = createPrivateFixture()
    const callsPath = path.join(fixture.repoRoot, 'gitleaks-calls.json')
    writeExecutable(path.join(fixture.binDir, 'gitleaks'), [
      'const fs = require("node:fs")',
      'const args = process.argv.slice(2)',
      'const callsPath = process.env.FAKE_GITLEAKS_CALLS',
      'const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf-8")) : []',
      'calls.push(args)',
      'fs.writeFileSync(callsPath, JSON.stringify(calls))',
      'process.exit(0)',
    ])

    const allResult = runCli(['private', 'secret-scan', '--manifest', fixture.manifestPath], fixture.repoRoot, fixture.homeRoot, {
      FAKE_GITLEAKS_CALLS: callsPath,
      PATH: testPath(fixture.binDir),
    })
    const stagedResult = runCli(['private', 'secret-scan', '--manifest', fixture.manifestPath, '--staged'], fixture.repoRoot, fixture.homeRoot, {
      FAKE_GITLEAKS_CALLS: callsPath,
      PATH: testPath(fixture.binDir),
    })

    assert.equal(allResult.status, 0, `${allResult.stdout}\n${allResult.stderr}`)
    assert.equal(stagedResult.status, 0, `${stagedResult.stdout}\n${stagedResult.stderr}`)
    const calls = readJsonFile(callsPath)
    assert.deepEqual(calls[0], ['detect', '--source', fixture.repoRoot, '--no-git', '--redact', '--verbose'])
    assert.deepEqual(calls[1], ['protect', '--staged', '--redact', '--verbose'])
  })
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
