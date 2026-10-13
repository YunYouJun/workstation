import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigurationEngine } from '../src/configuration/engine'
import { skillDirectoryDigest } from '../src/skill-provenance'
import * as skills from '../src/skills'

let root: string
let home: string
let repo: string
let manifest: string
let engine: ConfigurationEngine

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
function skill(directory: string, name = path.basename(directory)) {
  write(path.join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Test Skill\n---\n# ${name}\n`)
  return path.join(directory, 'SKILL.md')
}
function privateSkill(name: string, shared = false) {
  const value = JSON.parse(fs.readFileSync(manifest, 'utf8'))
  value.skills = { install: [{ id: name, root: shared ? 'shared' : 'codex', source: { type: 'local', path: `skills/${name}` } }] }
  write(manifest, JSON.stringify(value))
  skill(path.join(repo, 'skills', name))
  const file = skill(path.join(home, shared ? '.agents/skills' : '.codex/skills', name))
  write(file, `${fs.readFileSync(file, 'utf8')}Local change\n`)
  return file
}
function apm(name: string) {
  write(path.join(home, '.apm/apm.yml'), 'name: fixture\nversion: 1.0.0\n')
  write(path.join(home, '.apm/apm.lock.yaml'), `lockfile_version: 1\ndependencies:\n- name: fixture\n  deployed_files:\n  - .agents/skills/${name}/SKILL.md\n`)
}
function registry(name: string, location = path.join(home, '.agents/.skill-lock.json')) {
  write(location, JSON.stringify({ version: 3, skills: { [name]: { source: 'owner/repo', sourceType: 'github', sourceUrl: 'https://example.org/owner/repo', skillFolderHash: 'fixture' } } }))
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workstation-skills-inventory-')))
  home = path.join(root, 'home')
  repo = path.join(root, 'repo')
  manifest = path.join(repo, 'config/sync-manifest.json')
  vi.stubEnv('XDG_STATE_HOME', '')
  write(manifest, JSON.stringify({ policy: { plaintextSecretsAllowed: false, secretSource: '1Password' }, workstationOverlay: { contractVersion: 1, defaultMode: 'dry-run', secretSource: '1Password', allowedReadPaths: ['skills/*', 'mcp/*'], allowedOperations: ['private-skill-install', 'managed-block-fragment'] } }))
  engine = new ConfigurationEngine({ home, repo, manifest })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('configuration Skills audit integration', () => {
  it('reports proven ownership, deployment instances and nested Skills without taking ownership by name', () => {
    const apmFile = skill(path.join(home, '.agents/skills/apm-owned'))
    apm('apm-owned')
    const registryFile = skill(path.join(home, '.agents/skills/registry-owned'))
    registry('registry-owned')
    const sameName = skill(path.join(home, '.codex/skills/registry-owned'))
    const workstationRoot = path.join(home, '.codex/skills/workstation-owned')
    const workstationFile = skill(workstationRoot)
    write(path.join(home, '.agents/.wst-skill-lock.json'), JSON.stringify({ version: 1, skills: { 'workstation-owned': { root: 'codex', digest: skillDirectoryDigest(workstationRoot) } } }))
    const externalRoot = path.join(root, 'external')
    skill(externalRoot)
    fs.symlinkSync(externalRoot, path.join(home, '.codex/skills/external-link'))
    const pluginRoot = path.join(home, '.codex/plugins/cache/fixture/skills/plugin-skill')
    skill(pluginRoot)
    fs.symlinkSync(pluginRoot, path.join(home, '.codex/skills/plugin-link'))
    const nested = skill(path.join(home, '.codex/skills/wrapper/references/nested'))
    const result = engine.inspect()
    const item = (file: string) => result.items.find(item => item.localPath === file)!
    expect(item(apmFile)).toMatchObject({ client: 'shared', scope: 'global', manager: 'apm', owner: 'installer', status: 'read-only' })
    expect(item(registryFile).manager).toBe('skills-cli')
    expect(item(sameName).manager).toBe('unknown')
    expect(item(workstationFile).manager).toBe('workstation')
    expect(item(path.join(home, '.codex/skills/external-link/SKILL.md')).manager).toBe('external')
    expect(item(path.join(home, '.codex/skills/plugin-link/SKILL.md')).manager).toBe('native-plugin')
    expect(item(nested)).toMatchObject({ owner: 'installer', status: 'read-only', manager: 'unknown' })
    expect(result.skillsAudit.state).toBe('available')
    expect(result.skillsAudit.findings.some(finding => finding.code === 'duplicate-skill-name')).toBe(true)
    expect(fs.existsSync(engine.state)).toBe(false)
    expect(new Set(result.items.filter(item => item.kind === 'skill').map(item => item.localPath)).size).toBe(result.items.filter(item => item.kind === 'skill').length)
  })

  it('includes only the selected project while keeping the CLI audit cwd default', () => {
    const project = path.join(root, 'project')
    const projectFile = skill(path.join(project, '.agents/skills/project-only'))
    write(path.join(project, '.agents/skills/project-only/agents/openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n')
    write(path.join(project, '.codex/config.toml'), '[mcp_servers.project]\ncommand="node"\n')
    expect(engine.inspect().items.some(item => item.scope === 'project')).toBe(false)
    const selected = engine.inspect(project)
    expect(selected.items.find(item => item.localPath === projectFile)).toMatchObject({ manager: 'project', scope: 'project', client: 'shared', owner: 'project', status: 'read-only' })
    expect(selected.items.find(item => item.id === 'project-mcp:project')).toMatchObject({ manager: 'project', scope: 'project', client: 'codex' })
    expect(selected.skillsAudit.summary?.explicitOnlySkillCount).toBe(1)
    expect(skills.auditSkills({ home, codexHome: path.join(home, '.codex') }).roots.some(root => root.kind === 'project' && root.path === path.join(process.cwd(), '.agents/skills'))).toBe(true)
    expect(fs.existsSync(engine.state)).toBe(false)
  })

  it('protects APM and skills.sh deployments even when a private source also declares them', () => {
    const file = privateSkill('overlap', true)
    apm('overlap')
    const row = engine.inspect().items.find(item => item.title === 'overlap')!
    expect(row).toMatchObject({ manager: 'apm', owner: 'installer', status: 'read-only' })
    expect(() => engine.preview([{ id: row.id, revision: row.revision, choice: 'source' }])).toThrow('not writable')
    registry('overlap')
    fs.unlinkSync(path.join(home, '.apm/apm.lock.yaml'))
    expect(engine.inspect().items.find(item => item.title === 'overlap')?.manager).toBe('skills-cli')
    expect(fs.readFileSync(file, 'utf8')).toContain('Local change')
    expect(fs.existsSync(engine.state)).toBe(false)
  })

  it('preserves user tree review and recovery with Workstation provenance, and rejects later installer takeover', () => {
    const file = privateSkill('notes', true)
    write(path.join(home, '.agents/.wst-skill-lock.json'), JSON.stringify({ version: 1, skills: { notes: { root: 'shared', digest: skillDirectoryDigest(path.dirname(file)) } } }))
    const row = engine.inspect().items.find(item => item.localPath === file)!
    expect(row).toMatchObject({ owner: 'user', manager: 'workstation', status: 'first-adoption' })
    const plan = engine.preview([{ id: row.id, revision: row.revision, choice: 'source' }])
    engine.apply(plan.planId)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('Local change')
    engine.restore(plan.planId)
    expect(fs.readFileSync(file, 'utf8')).toContain('Local change')
    const refreshed = engine.inspect().items.find(item => item.localPath === file)!
    const stalePlan = engine.preview([{ id: refreshed.id, revision: refreshed.revision, choice: 'source' }])
    apm('notes')
    expect(() => engine.apply(stalePlan.planId)).toThrow('changed')
    expect(fs.readFileSync(file, 'utf8')).toContain('Local change')
  })

  it.each(['apm', 'skills-cli'])('rejects recovery after %s adopts an unchanged deployment', (manager) => {
    const file = privateSkill('notes', true)
    const row = engine.inspect().items.find(item => item.localPath === file)!
    const plan = engine.preview([{ id: row.id, revision: row.revision, choice: 'source' }])
    engine.apply(plan.planId)
    const applied = fs.readFileSync(file, 'utf8')
    const savedPlan = fs.readFileSync(path.join(engine.state, `${plan.planId}.json`), 'utf8')
    if (manager === 'apm')
      apm('notes')
    else registry('notes')
    expect(() => engine.restore(plan.planId)).toThrow('Skill ownership changed')
    expect(fs.readFileSync(file, 'utf8')).toBe(applied)
    expect(fs.readFileSync(path.join(engine.state, `${plan.planId}.json`), 'utf8')).toBe(savedPlan)
    expect(engine.history().plans.find(saved => saved.planId === plan.planId)?.state).toBe('applied')
  })

  it.each([false, true])('keeps older plan recovery safe with installer takeover=%s', (takeover) => {
    const file = privateSkill('notes', true)
    const row = engine.inspect().items.find(item => item.localPath === file)!
    const plan = engine.preview([{ id: row.id, revision: row.revision, choice: 'source' }])
    engine.apply(plan.planId)
    const savedPath = path.join(engine.state, `${plan.planId}.json`)
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'))
    saved.reads = saved.reads.filter((read: { path: string }) => !saved.skillOwnershipPaths.includes(read.path))
    delete saved.skillOwnershipPaths
    write(savedPath, JSON.stringify(saved))
    if (takeover) {
      apm('notes')
      const applied = fs.readFileSync(file, 'utf8')
      expect(() => engine.restore(plan.planId)).toThrow('Skill ownership changed')
      expect(fs.readFileSync(file, 'utf8')).toBe(applied)
    }
    else {
      expect(engine.restore(plan.planId).state).toBe('restored')
      expect(fs.readFileSync(file, 'utf8')).toContain('Local change')
    }
  })

  it('withholds names from display findings while preserving full CLI audit diagnostics', () => {
    const name = `duplicate\u0007${'duplicate-name-'.repeat(300)}`
    skill(path.join(home, '.codex/skills/first'), JSON.stringify(name))
    skill(path.join(home, '.codex/skills/second'), JSON.stringify(name))
    const raw = skills.auditSkills({ home, codexHome: path.join(home, '.codex'), includeProject: false })
    const rawDuplicate = raw.findings.find(finding => finding.code === 'duplicate-skill-name-in-root')!
    expect(rawDuplicate.message.length).toBeGreaterThan(2000)
    expect(rawDuplicate.message).toContain('\u0007')
    const result = engine.inspect()
    const displayed = result.skillsAudit.findings.find(finding => finding.code === 'duplicate-skill-name-in-root')!
    expect(result.skillsAudit.state).toBe('available')
    expect(displayed.message).toBe('Skill name is present multiple times in the same discovery root.')
    expect(displayed.message).not.toContain('duplicate-name-')
    expect(result.skillsAudit.findings.every(finding => finding.message.length <= 2000 && !/\p{Cc}/u.test(finding.message))).toBe(true)
    expect(fs.existsSync(engine.state)).toBe(false)
  })

  it('returns fixed guidance for every finding and retains its summary, severity and paths', () => {
    const report = skills.auditSkills({ home, codexHome: path.join(home, '.codex'), includeProject: false })
    const codes = [
      'invalid-skill-symlink',
      'skill-discovery-limit-exceeded',
      'unreadable-skill-directory',
      'invalid-skill-frontmatter',
      'nonstandard-skill-name',
      'invalid-skill-openai-config',
      'verbose-skill-description',
      'oversized-skill-body',
      'missing-apm-lock',
      'missing-apm-manifest',
      'invalid-apm-manifest',
      'invalid-apm-lock',
      'missing-apm-lock-dependency',
      'invalid-apm-deployed-path',
      'missing-apm-deployed-file',
      'modified-apm-deployed-file',
      'invalid-skills-registry-lock',
      'invalid-workstation-skill-lock',
      'missing-workstation-skill',
      'modified-workstation-skill',
      'unmanaged-shared-skill',
      'missing-apm-deployment',
      'skill-directory-name-mismatch',
      'duplicate-skill-name',
      'duplicate-skill-name-in-root',
      'future-finding',
    ]
    const file = path.join(home, '.agents/skills/fixture/SKILL.md')
    report.findings = codes.map(code => ({ code, severity: 'error', paths: [file], message: 'private-credential-before-colon: private-credential-after-colon\u0007' }))
    report.summary.errorCount = codes.length
    vi.spyOn(skills, 'auditSkills').mockReturnValue(report)
    const audit = engine.inspect().skillsAudit
    expect(audit.state).toBe('available')
    const { skillFileCount, implicitSkillCount, explicitOnlySkillCount, warningCount, errorCount } = report.summary
    expect(audit.summary).toEqual({ skillFileCount, implicitSkillCount, explicitOnlySkillCount, warningCount, errorCount })
    expect(audit.findings).toHaveLength(codes.length)
    for (const finding of audit.findings) {
      expect(finding).toMatchObject({ severity: 'error', paths: [file] })
      expect(finding.message).not.toContain('private-credential')
      expect(finding.message.length).toBeLessThanOrEqual(2000)
      expect(finding.message).not.toMatch(/\p{Cc}/u)
    }
    expect(audit.findings.at(-1)?.message).toBe('Review the affected Skill files in the original manager.')
    expect(fs.existsSync(engine.state)).toBe(false)
  })

  it('reports invalid locks without exposing parser content and leaves unrelated MCP review available', () => {
    privateSkill('notes', true)
    write(path.join(home, '.apm/apm.lock.yaml'), 'secret: [very-secret-value\n')
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    value.mcp = { fragments: [{ id: 'fixture', path: 'mcp/config.toml', format: 'toml-codex', syncMode: 'install', operation: 'managed-block-fragment' }] }
    write(manifest, JSON.stringify(value))
    write(path.join(repo, 'mcp/config.toml'), '[mcp_servers.demo]\ncommand="node"\n')
    write(path.join(home, '.codex/config.toml'), '[mcp_servers.demo]\ncommand="npx"\n')
    const result = engine.inspect()
    expect(result.skillsAudit.findings.some(finding => finding.code === 'invalid-apm-lock')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('very-secret-value')
    expect(result.items.find(item => item.title === 'notes')?.status).toBe('read-only')
    const row = result.items.find(item => item.id === 'mcp:demo')!
    const plan = engine.preview([{ id: row.id, revision: row.revision, choice: 'source' }])
    expect(engine.apply(plan.planId).state).toBe('applied')
    expect(engine.restore(plan.planId).state).toBe('restored')
  })

  it('degrades a failed audit without hiding configuration items or writing state', () => {
    skill(path.join(home, '.codex/skills/fixture'))
    vi.spyOn(skills, 'auditSkills').mockImplementation(() => {
      throw new Error('secret parser content')
    })
    const result = engine.inspect()
    expect(result.skillsAudit).toMatchObject({ state: 'error', findings: [] })
    expect(result.items.some(item => item.title === 'fixture')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret parser content')
    expect(fs.existsSync(engine.state)).toBe(false)
  })

  it('uses the configured XDG registry lock for ownership and preserves external links', () => {
    const state = path.join(root, 'xdg-state')
    vi.stubEnv('XDG_STATE_HOME', state)
    const file = skill(path.join(home, '.agents/skills/registered'))
    registry('registered', path.join(state, 'skills/.skill-lock.json'))
    const result = engine.inspect()
    expect(result.items.find(item => item.localPath === file)?.provenance?.path).toBe(path.join(state, 'skills/.skill-lock.json'))
    expect(result.items.find(item => item.localPath === file)?.manager).toBe('skills-cli')
    expect(fs.existsSync(engine.state)).toBe(false)
  })
})
