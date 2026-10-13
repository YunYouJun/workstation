import type { DoctorOptions } from '../src/doctor'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { doctor, inspectDoctor, probeDoctorDependency } from '../src/doctor'
import { hostRequest } from '../src/host-protocol'
import { writeFile } from './utils'

let root: string
let options: DoctorOptions
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-doctor-'))
  options = {
    repoRoot: root,
    manifestPath: null,
    platform: 'darwin',
    entries: [{ source: 'home/dot_zshrc', target: '.zshrc' }],
    probe: () => 'available',
    now: () => new Date('2026-10-13T00:00:00.000Z'),
  }
  writeFile(path.join(root, '.chezmoiroot'), 'home\n')
  writeFile(path.join(root, 'home/dot_apm/apm.yml'), 'name: sample\n')
  writeFile(path.join(root, 'home/dot_apm/private_apm.lock.yaml'), 'dependencies: {}\n')
  writeFile(path.join(root, 'home/dot_zshrc'), '# ordinary source\n')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('structured doctor', () => {
  it('reports ready dependencies and fixed sources without writing state', () => {
    const write = vi.spyOn(fs, 'writeFileSync')
    const mkdir = vi.spyOn(fs, 'mkdirSync')
    const report = inspectDoctor(options)
    expect(report).toMatchObject({ version: 1, checkedAt: '2026-10-13T00:00:00.000Z', summary: { errors: 0, warnings: 0 } })
    expect(report.summary.passed).toBe(report.checks.length)
    expect(report.checks).toContainEqual({ code: 'dependency-brew-ready', severity: 'info', message: 'brew executable is available.' })
    expect(write).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('redacts root contents, YAML excerpts, secret keys and values', () => {
    writeFile(path.join(root, '.chezmoiroot'), 'secret-root-contents')
    writeFile(path.join(root, 'home/dot_apm/apm.yml'), 'token: secret-yaml-excerpt\ninvalid: [')
    writeFile(path.join(root, 'home/dot_zshrc'), 'export MISSING={{DOTFILES_SECRET:PRIVATE_TOKEN_NAME}}\n')
    writeFile(path.join(root, '.env.local'), 'ANOTHER_PRIVATE_KEY=secret-local-value\n')
    const report = inspectDoctor(options)
    expect(report.checks.map(check => check.code)).toEqual(expect.arrayContaining(['chezmoi-root-invalid', 'apm-manifest-invalid', 'source-secrets-missing']))
    const output = JSON.stringify(report)
    for (const sensitive of ['secret-root-contents', 'secret-yaml-excerpt', 'PRIVATE_TOKEN_NAME', 'ANOTHER_PRIVATE_KEY', 'secret-local-value'])
      expect(output).not.toContain(sensitive)
  })

  it('recognizes nonempty local placeholders, but reports blank values as unresolved', () => {
    writeFile(path.join(root, 'home/dot_zshrc'), '{{DOTFILES_SECRET:PRIVATE_KEY}}')
    writeFile(path.join(root, '.env.local'), 'PRIVATE_KEY="local-value"\n')
    expect(inspectDoctor(options).summary.errors).toBe(0)
    writeFile(path.join(root, '.env.local'), 'PRIVATE_KEY=""\n')
    expect(inspectDoctor(options).checks.some(check => check.code === 'source-secrets-missing')).toBe(true)
  })

  it('returns unreadable, binary and oversized sources as fixed errors', () => {
    fs.mkdirSync(path.join(root, '.env.local'))
    writeFile(path.join(root, '.chezmoiroot'), 'home\0secret-value')
    writeFile(path.join(root, 'home/dot_zshrc'), 'x'.repeat(1024 * 1024 + 1))
    const report = inspectDoctor(options)
    expect(report.checks.map(check => check.code)).toEqual(expect.arrayContaining(['secrets-file-unreadable', 'chezmoi-root-unreadable', 'source-unreadable']))
    expect(JSON.stringify(report)).not.toContain('secret-value')
  })

  it('reports dependency absence and failures without exception details', () => {
    const probe = vi.fn((command: string) => {
      if (command === 'apm')
        return 'missing' as const
      if (command === 'chezmoi')
        throw new Error('stderr secret-value')
      return 'available' as const
    })
    const report = inspectDoctor({ ...options, probe })
    expect(report.checks.map(check => check.code)).toEqual(expect.arrayContaining(['dependency-apm-missing', 'dependency-chezmoi-failed']))
    expect(report.summary.warnings).toBe(2)
    expect(JSON.stringify(report)).not.toContain('secret-value')
    expect(probe).toHaveBeenCalledWith('gitleaks', ['version'])
    expect(probe).toHaveBeenCalledWith('chezmoi', ['--version'])
  })

  it('validates private manifests without returning schema keys or values', () => {
    const manifestPath = path.join(root, 'private.json')
    writeFile(manifestPath, '{"secret-schema-key":"secret-value","workstationOverlay":{"allowedOperations":["private-secret-operation"]}}')
    const report = inspectDoctor({ ...options, manifestPath })
    expect(report.checks.map(check => check.code)).toContain('private-manifest-invalid')
    expect(JSON.stringify(report)).not.toMatch(/secret-schema-key|secret-value|private-secret-operation/)
  })

  it('bounds private connection configuration and fallback discovery reads', () => {
    vi.stubEnv('DOTFILES_HOME', root)
    vi.stubEnv('WORKSTATION_PRIVATE_MANIFEST', '')
    const config = path.join(root, 'connection.json')
    vi.stubEnv('WORKSTATION_PRIVATE_CONFIG', config)
    writeFile(config, 'x'.repeat(1024 * 1024 + 1))
    expect(inspectDoctor({ ...options, manifestPath: undefined }).checks.map(check => check.code)).toContain('private-manifest-unavailable')
    fs.rmSync(config)
    for (let index = 0; index < 520; index++)
      fs.mkdirSync(path.join(root, 'repos', `repository-${index}`), { recursive: true })
    expect(inspectDoctor({ ...options, manifestPath: undefined }).checks.map(check => check.code)).toContain('private-manifest-unavailable')
    expect(fs.existsSync(config)).toBe(false)
  })

  it('reuses existing private connection paths without writing them', () => {
    vi.stubEnv('DOTFILES_HOME', root)
    vi.stubEnv('WORKSTATION_PRIVATE_MANIFEST', '')
    const config = path.join(root, 'connection.json')
    vi.stubEnv('WORKSTATION_PRIVATE_CONFIG', config)
    const manifestPath = path.join(root, 'private/config/sync-manifest.json')
    writeFile(manifestPath, JSON.stringify({ policy: { plaintextSecretsAllowed: false }, workstationOverlay: { contractVersion: 1, defaultMode: 'dry-run', secretSource: '1Password', allowedReadPaths: ['mcp/*'], allowedOperations: [] } }))
    writeFile(config, JSON.stringify({ manifestPath }))
    expect(inspectDoctor({ ...options, manifestPath: undefined }).checks).toContainEqual({ code: 'private-manifest-ready', severity: 'info', message: 'Private configuration manifest is valid.', path: manifestPath })
    expect(JSON.parse(fs.readFileSync(config, 'utf8'))).toEqual({ manifestPath })
  })

  it('keeps Windows diagnostic checks read-only and skips macOS-only sources', () => {
    const probe = vi.fn((_command: string, _args: string[]) => 'available' as const)
    const report = hostRequest({ version: 1, operation: 'doctor' }, { platform: 'win32', doctor: { ...options, probe, entries: [{ source: 'home/Library/Application Support/Code/User/settings.json', target: 'unused' }] } })
    expect(report).toMatchObject({ summary: { errors: 0, warnings: 1 } })
    expect('checks' in report && report.checks.map(check => check.code)).toEqual(expect.arrayContaining(['source-platform-skipped', 'configuration-platform-read-only', 'software-platform-unsupported']))
    expect(probe.mock.calls.some(([command]) => command === 'brew' || command === 'zsh')).toBe(false)
  })

  it('bounds checks and reports truncation instead of implying all files passed', () => {
    const report = inspectDoctor({ ...options, entries: Array.from({ length: 1000 }, () => ({ source: 'home/dot_zshrc', target: '.zshrc' })) })
    expect(report.checks.length).toBeLessThanOrEqual(200)
    expect(report.checks.at(-1)?.code).toBe('doctor-report-truncated')
    expect(report.summary.warnings).toBe(1)
  })

  it('uses the same report counts for terminal doctor', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(doctor(options)).toEqual(inspectDoctor(options).summary)
  })

  it('bounds actual subprocess duration and discards stdout/stderr', () => {
    expect(probeDoctorDependency(process.execPath, ['-e', 'process.stderr.write("private-error");process.exit(1)'])).toBe('failed')
    expect(probeDoctorDependency(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'])).toBe('failed')
    const start = Date.now()
    expect(probeDoctorDependency(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'])).toBe('failed')
    expect(Date.now() - start).toBeLessThan(5000)
    expect(probeDoctorDependency(path.join(root, 'absent-executable'), ['--version'])).toBe('missing')
  })
})
