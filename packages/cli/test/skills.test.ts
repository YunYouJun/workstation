import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, it } from 'vitest'
import { skillDirectoryDigest } from '../src/skill-provenance'
import { createTempDir, removePath, runCli, writeFile } from './utils'

let tempDir: string | undefined

function skill(name: string, description = `${name} test skill`) {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n')
}

afterEach(() => {
  removePath(tempDir)
  tempDir = undefined
})

describe('skill provenance digest', () => {
  it('keeps file names and contents in distinct hash fields', () => {
    tempDir = createTempDir('workstation-skill-digest-')
    const left = path.join(tempDir, 'left')
    const right = path.join(tempDir, 'right')
    writeFile(path.join(left, 'a'), 'bfileX')
    writeFile(path.join(right, 'afileb'), 'X')

    assert.notEqual(skillDirectoryDigest(left), skillDirectoryDigest(right))
  })
})

describe('skills audit CLI', () => {
  it('reports APM as not configured when both manifest and lockfile are absent', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /APM: \[not configured\]/)
  })

  it('audits the repository project skills when run through the root package script', () => {
    tempDir = createTempDir('workstation-skills-')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const result = spawnSync('pnpm', ['--dir', repoRoot, 'skills:audit', '--json'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CODEX_HOME: path.join(tempDir, 'codex'),
        DOTFILES_HOME: path.join(tempDir, 'home'),
        NO_COLOR: '1',
      },
    })

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    const project = report.roots.find((root: { kind: string }) => root.kind === 'project')
    assert.equal(project.path, path.join(repoRoot, '.agents', 'skills'))
    assert.equal(project.topLevelSkillCount, 1)
  })

  it('reports APM-managed, unmanaged, and duplicate skills through JSON output', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')

    writeFile(path.join(homeRoot, '.agents', 'skills', 'managed', 'SKILL.md'), skill('managed'))
    writeFile(path.join(homeRoot, '.agents', 'skills', 'rogue', 'SKILL.md'), skill('rogue'))
    writeFile(path.join(homeRoot, '.agents', 'skills', 'rogue-two', 'SKILL.md'), skill('rogue-two'))
    writeFile(path.join(homeRoot, '.codex', 'skills', 'managed', 'SKILL.md'), skill('managed'))
    writeFile(path.join(projectRoot, '.agents', 'skills', 'project-only', 'SKILL.md'), skill('project-only'))
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: 1',
      'dependencies:',
      '- name: managed-package',
      '  deployed_files:',
      '  - .agents/skills/managed',
      '  - .agents/skills/managed/SKILL.md',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.apm.manifestExists, true)
    assert.equal(report.apm.lockExists, true)
    assert.equal(report.apm.managedSkillCount, 1)
    assert.equal(report.summary.topLevelSkillCount, 5)
    assert.equal(report.summary.managedSharedSkillCount, 1)
    assert.equal(report.summary.unmanagedSharedSkillCount, 2)
    assert.equal(report.summary.errorCount, 0)
    assert.equal(report.summary.warningCount, 2)
    assert.deepEqual(
      report.findings.map((finding: { code: string }) => finding.code).sort(),
      ['duplicate-skill-name', 'unmanaged-shared-skill'],
    )
    const unmanaged = report.findings.find((finding: { code: string }) => finding.code === 'unmanaged-shared-skill')
    assert.equal(unmanaged.paths.length, 2)
  })

  it('recognizes globally installed skills declared by the skills.sh lock', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(homeRoot, '.agents', 'skills', 'registry-managed', 'SKILL.md'), skill('registry-managed'))
    writeFile(path.join(homeRoot, '.agents', '.skill-lock.json'), JSON.stringify({
      skills: {
        'registry-managed': {
          skillFolderHash: 'abc123',
          skillPath: 'skills/registry-managed/SKILL.md',
          source: 'owner/repository',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repository.git',
        },
      },
      version: 3,
    }))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.skillsRegistry.lockExists, true)
    assert.equal(report.skillsRegistry.managedSkillCount, 1)
    assert.equal(report.summary.managedSharedSkillCount, 1)
    assert.equal(report.summary.unmanagedSharedSkillCount, 0)
    assert.deepEqual(report.findings, [])
  })

  it('honors the skills.sh XDG state lock location', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const stateRoot = path.join(tempDir, 'state')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(homeRoot, '.agents', 'skills', 'registry-managed', 'SKILL.md'), skill('registry-managed'))
    writeFile(path.join(stateRoot, 'skills', '.skill-lock.json'), JSON.stringify({
      skills: {
        'registry-managed': {
          skillFolderHash: 'abc123',
          skillPath: 'skills/registry-managed/SKILL.md',
          source: 'owner/repository',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repository.git',
        },
      },
      version: 3,
    }))

    const result = runCli(
      ['skills', 'audit', '--project-root', projectRoot, '--check', '--json'],
      repoRoot,
      homeRoot,
      { XDG_STATE_HOME: stateRoot },
    )

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.skillsRegistry.lockExists, true)
    assert.equal(report.summary.unmanagedSharedSkillCount, 0)
  })

  it('fails check mode when the skills.sh lock has an invalid structure', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.agents', '.skill-lock.json'), JSON.stringify({ skills: [], version: 3 }))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-skills-registry-lock')
  })

  it.runIf(process.platform !== 'win32')('rejects broken symbolic links for APM and skills.sh control files', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(path.join(homeRoot, '.apm'), { recursive: true })
    fs.mkdirSync(path.join(homeRoot, '.agents'), { recursive: true })
    fs.mkdirSync(projectRoot, { recursive: true })
    fs.symlinkSync(path.join(tempDir, 'missing-apm.yml'), path.join(homeRoot, '.apm', 'apm.yml'))
    fs.symlinkSync(path.join(tempDir, 'missing-apm.lock.yaml'), path.join(homeRoot, '.apm', 'apm.lock.yaml'))
    fs.symlinkSync(path.join(tempDir, 'missing-skill-lock.json'), path.join(homeRoot, '.agents', '.skill-lock.json'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.apm.manifestExists, true)
    assert.equal(report.apm.lockExists, true)
    assert.equal(report.skillsRegistry.lockExists, true)
    assert.deepEqual(
      report.findings.map((finding: { code: string }) => finding.code),
      ['invalid-apm-lock', 'invalid-apm-manifest', 'invalid-skills-registry-lock'],
    )
  })

  it('rejects unsafe Skill directory names in the skills.sh lock', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.agents', '.skill-lock.json'), JSON.stringify({
      skills: {
        '../escaped': {
          skillFolderHash: 'abc123',
          skillPath: 'skills/escaped/SKILL.md',
          source: 'owner/repository',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repository.git',
        },
      },
      version: 3,
    }))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.findings[0].code, 'invalid-skills-registry-lock')
    assert.match(report.findings[0].message, /safe directory name/)
  })

  it('does not require every globally registered Skill to target the shared root', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.agents', '.skill-lock.json'), JSON.stringify({
      skills: {
        missing: {
          skillFolderHash: 'abc123',
          skillPath: 'skills/missing/SKILL.md',
          source: 'owner/repository',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repository.git',
        },
      },
      version: 3,
    }))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 0)
    assert.deepEqual(report.findings, [])
  })

  it('fails check mode when the workstation Skill provenance lock is invalid', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.agents', '.wst-skill-lock.json'), '{\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.workstation.lockExists, true)
    assert.equal(report.findings[0].code, 'invalid-workstation-skill-lock')
  })

  it.runIf(process.platform !== 'win32')('fails check mode when the workstation provenance lock is a broken symbolic link', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(path.join(homeRoot, '.agents'), { recursive: true })
    fs.mkdirSync(projectRoot, { recursive: true })
    fs.symlinkSync(path.join(tempDir, 'missing-lock.json'), path.join(homeRoot, '.agents', '.wst-skill-lock.json'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.workstation.lockExists, true)
    assert.equal(report.findings[0].code, 'invalid-workstation-skill-lock')
  })

  it('fails check mode when a workstation-managed Skill is missing', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.agents', '.wst-skill-lock.json'), JSON.stringify({
      skills: {
        missing: {
          digest: `sha256:${'0'.repeat(64)}`,
          root: 'shared',
        },
      },
      version: 1,
    }))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.workstation.managedSkillCount, 1)
    assert.equal(report.findings[0].code, 'missing-workstation-skill')
  })

  it('matches APM management by deployment alias rather than frontmatter name', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(homeRoot, '.agents', 'skills', 'local-alias', 'SKILL.md'), skill('upstream-name'))
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), [
      'name: test',
      'version: 1.0.0',
      'dependencies:',
      '  apm:',
      '  - git: owner/repo',
      '    alias: local-alias',
      '',
    ].join('\n'))
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: 1',
      'dependencies:',
      '- name: local-alias',
      '  deployed_files:',
      '  - .agents/skills/local-alias',
      '  - .agents/skills/local-alias/SKILL.md',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 0)
    assert.equal(report.summary.managedSharedSkillCount, 1)
    assert.equal(report.summary.unmanagedSharedSkillCount, 0)
    assert.deepEqual(report.findings, [])
  })

  it('accepts APM string shorthand dependencies', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(homeRoot, '.agents', 'skills', 'managed', 'SKILL.md'), skill('managed'))
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), [
      'name: test',
      'version: 1.0.0',
      'dependencies:',
      '  apm:',
      '  - owner/repo#v1.0.0',
      '',
    ].join('\n'))
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: \'1\'',
      'dependencies:',
      '- name: managed',
      '  repo_url: owner/repo',
      '  deployed_files:',
      '  - .agents/skills/managed',
      '  - .agents/skills/managed/SKILL.md',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 0)
    assert.equal(report.apm.managedSkillCount, 1)
  })

  it('accepts APM local-path and marketplace object dependencies', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), [
      'name: test',
      'version: 1.0.0',
      'dependencies:',
      '  apm:',
      '  - path: ./local-skill',
      '  - name: marketplace-skill',
      '    marketplace: owner/marketplace',
      '    version: 1.0.0',
      '',
    ].join('\n'))
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), 'lockfile_version: 1\ndependencies: []\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 0)
  })

  it('limits APM deployed-file checks to the shared Skills root', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(homeRoot, '.agents', 'skills', 'managed', 'SKILL.md'), skill('managed'))
    writeFile(path.join(homeRoot, '.codex', 'prompts', 'review.md'), '# Review\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\ndependencies: {}\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: \'1\'',
      'dependencies:',
      '- name: managed',
      '  deployed_files:',
      '  - .agents/skills/managed',
      '  - .agents/skills/managed/SKILL.md',
      '  - .codex/prompts/review.md',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 0)
    assert.equal(report.apm.managedSkillCount, 1)
  })

  it('distinguishes duplicate names within one discovery root', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(projectRoot, '.agents', 'skills', 'first', 'SKILL.md'), skill('duplicate'))
    writeFile(path.join(projectRoot, '.agents', 'skills', 'second', 'SKILL.md'), skill('duplicate'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.deepEqual(
      report.findings.map((finding: { code: string }) => finding.code),
      ['duplicate-skill-name-in-root', 'skill-directory-name-mismatch'],
    )
    assert.match(
      report.findings.find((finding: { code: string }) => finding.code === 'duplicate-skill-name-in-root').message,
      /same discovery root/,
    )
  })

  it('fails check mode when an APM manifest has no lockfile', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'missing-apm-lock')
  })

  it('fails check mode when an APM lockfile has no manifest', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), 'lockfile_version: 1\ndependencies: []\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'missing-apm-manifest')
  })

  it('fails check mode when the APM lockfile is invalid YAML', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), 'dependencies: [\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-apm-lock')
  })

  it('fails check mode when a file declared by the APM lock is missing', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.agents', 'skills', 'managed', 'SKILL.md'), skill('managed'))
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\ndependencies: {}\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: 1',
      'dependencies:',
      '- name: managed',
      '  deployed_files:',
      '  - .agents/skills/managed',
      '  - .agents/skills/managed/SKILL.md',
      '  - .agents/skills/managed/references/missing.md',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'missing-apm-deployed-file')
    assert.match(report.findings[0].paths[0], /missing\.md$/)
  })

  it('rejects APM-deployed paths that escape the shared skills root', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\ndependencies: {}\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: 1',
      'dependencies:',
      '- name: escaped',
      '  deployed_files:',
      '  - .agents/skills/../../../outside.txt',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-apm-deployed-path')
    assert.deepEqual(report.findings[0].paths, ['.agents/skills/../../../outside.txt'])
  })

  it.runIf(process.platform !== 'win32')('rejects APM-deployed symlinks that escape the shared skills root', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const managedRoot = path.join(homeRoot, '.agents', 'skills', 'managed')
    const outsideFile = path.join(homeRoot, 'outside.txt')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(managedRoot, 'SKILL.md'), skill('managed'))
    writeFile(outsideFile, 'outside\n')
    fs.symlinkSync(outsideFile, path.join(managedRoot, 'escaped.txt'))
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\ndependencies: {}\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: 1',
      'dependencies:',
      '- name: managed',
      '  deployed_files:',
      '  - .agents/skills/managed',
      '  - .agents/skills/managed/SKILL.md',
      '  - .agents/skills/managed/escaped.txt',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-apm-deployed-path')
    assert.deepEqual(report.findings[0].paths, ['.agents/skills/managed/escaped.txt'])
  })

  it('fails check mode when an APM-managed file does not match its locked hash', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.agents', 'skills', 'managed', 'SKILL.md'), skill('managed'))
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\ndependencies: {}\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), [
      'lockfile_version: 1',
      'dependencies:',
      '- name: managed',
      '  deployed_files:',
      '  - .agents/skills/managed',
      '  - .agents/skills/managed/SKILL.md',
      '  deployed_file_hashes:',
      '    .agents/skills/managed/SKILL.md: sha256:deadbeef',
      '',
    ].join('\n'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'modified-apm-deployed-file')
    assert.match(report.findings[0].paths[0], /SKILL\.md$/)
  })

  it('fails check mode when the APM manifest is invalid YAML', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'dependencies: [\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), 'lockfile_version: 1\ndependencies: []\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-apm-manifest')
  })

  it('fails check mode when the APM manifest has an invalid structure', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), '[]\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), 'lockfile_version: 1\ndependencies: []\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-apm-manifest')
    assert.match(report.findings[0].message, /mapping/)
  })

  it('reports configured APM files as invalid when schema validation fails', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), '[]\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), 'lockfile_version: 1\ndependencies: []\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /APM: \[invalid\]/)
  })

  it('fails check mode when the APM lockfile has an invalid structure', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), 'name: test\nversion: 1.0.0\ndependencies: {}\n')
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), '[]\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-apm-lock')
    assert.match(report.findings[0].message, /mapping/)
  })

  it('fails check mode when a named APM manifest dependency is absent from the lock', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(projectRoot, { recursive: true })
    writeFile(path.join(homeRoot, '.apm', 'apm.yml'), [
      'name: test',
      'version: 1.0.0',
      'dependencies:',
      '  apm:',
      '  - git: https://example.com/skill.git',
      '    alias: expected-skill',
      '',
    ].join('\n'))
    writeFile(path.join(homeRoot, '.apm', 'apm.lock.yaml'), 'lockfile_version: 1\ndependencies: []\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'missing-apm-lock-dependency')
    assert.match(report.findings[0].message, /expected-skill/)
  })

  it('fails check mode when a top-level skill has invalid frontmatter', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(projectRoot, '.agents', 'skills', 'broken', 'SKILL.md'), '# Missing frontmatter\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'invalid-skill-frontmatter')
  })

  it('reports nonstandard Skill names as migration warnings', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(projectRoot, '.agents', 'skills', 'legacy-name', 'SKILL.md'), skill('Legacy_Name'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    const finding = report.findings.find((item: { code: string }) => item.code === 'nonstandard-skill-name')
    assert.equal(finding.severity, 'warning')
    assert.deepEqual(finding.paths, [path.join(projectRoot, '.agents', 'skills', 'legacy-name', 'SKILL.md')])
  })

  it('fails check mode when a Skill description exceeds the Codex limit', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(projectRoot, '.agents', 'skills', 'verbose', 'SKILL.md'), skill('verbose', 'x'.repeat(1025)))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.summary.descriptionCharacterCount, 1025)
    assert.equal(report.findings[0].code, 'invalid-skill-frontmatter')
    assert.match(report.findings[0].message, /1024/)
  })

  it('reports verbose descriptions and oversized Skill bodies as maintainability warnings', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const description = 'x'.repeat(501)
    const body = `${skill('large', description)}${Array.from({ length: 500 }).fill('detail').join('\n')}\n`
    writeFile(path.join(projectRoot, '.agents', 'skills', 'large', 'SKILL.md'), body)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.descriptionCharacterCount, 501)
    assert.equal(report.summary.longestDescriptionCharacterCount, 501)
    assert.equal(report.summary.verboseDescriptionCount, 1)
    assert.equal(report.summary.oversizedSkillBodyCount, 1)
    assert.deepEqual(
      report.findings.map((finding: { code: string }) => finding.code).sort(),
      ['oversized-skill-body', 'verbose-skill-description'],
    )
  })

  it('excludes explicit-only Skills from implicit metadata totals and verbose-description warnings', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const skillRoot = path.join(projectRoot, '.agents', 'skills', 'explicit-only')
    writeFile(path.join(skillRoot, 'SKILL.md'), skill('explicit-only', 'x'.repeat(501)))
    writeFile(path.join(skillRoot, 'agents', 'openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.descriptionCharacterCount, 501)
    assert.equal(report.summary.explicitOnlySkillCount, 1)
    assert.equal(report.summary.implicitDescriptionCharacterCount, 0)
    assert.equal(report.summary.implicitSkillCount, 0)
    assert.equal(report.summary.verboseDescriptionCount, 0)
    assert.deepEqual(report.findings, [])
  })

  it('fails check mode when agents/openai.yaml has an invalid implicit policy', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const skillRoot = path.join(projectRoot, '.agents', 'skills', 'broken-policy')
    const openaiConfig = path.join(skillRoot, 'agents', 'openai.yaml')
    writeFile(path.join(skillRoot, 'SKILL.md'), skill('broken-policy'))
    writeFile(openaiConfig, 'policy:\n  allow_implicit_invocation: sometimes\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.findings[0].code, 'invalid-skill-openai-config')
    assert.deepEqual(report.findings[0].paths, [openaiConfig])
  })

  it('warns when a Skill directory does not match its declared name', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const skillPath = path.join(projectRoot, '.agents', 'skills', 'folder-name', 'SKILL.md')
    writeFile(skillPath, skill('declared-name'))

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 0)
    assert.equal(report.findings[0].code, 'skill-directory-name-mismatch')
    assert.deepEqual(report.findings[0].paths, [skillPath])
  })

  it('validates recursively discovered nested skills', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    writeFile(path.join(projectRoot, '.agents', 'skills', 'wrapper', 'SKILL.md'), skill('wrapper'))
    writeFile(path.join(projectRoot, '.agents', 'skills', 'wrapper', 'references', 'nested', 'SKILL.md'), '# Missing frontmatter\n')

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.skillFileCount, 2)
    assert.equal(report.findings[0].code, 'invalid-skill-frontmatter')
  })

  it.runIf(process.platform !== 'win32')('discovers valid symbolic-link Skills', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const target = path.join(tempDir, 'linked-skill')
    const link = path.join(projectRoot, '.agents', 'skills', 'linked')
    writeFile(path.join(target, 'SKILL.md'), skill('linked'))
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.roots.find((root: { kind: string }) => root.kind === 'project').topLevelSkillCount, 1)
    assert.equal(report.summary.skillFileCount, 1)
  })

  it.runIf(process.platform !== 'win32')('validates nested Skills inside a symbolic-link Skill', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const target = path.join(tempDir, 'linked-skill')
    const link = path.join(projectRoot, '.agents', 'skills', 'linked')
    writeFile(path.join(target, 'SKILL.md'), skill('linked'))
    writeFile(path.join(target, 'references', 'nested', 'SKILL.md'), '# Missing frontmatter\n')
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.skillFileCount, 2)
    assert.equal(report.findings[0].code, 'invalid-skill-frontmatter')
  })

  it.runIf(process.platform !== 'win32')('deduplicates the same real Skill exposed through multiple roots', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const sharedSkill = path.join(homeRoot, '.agents', 'skills', 'shared')
    const projectLink = path.join(projectRoot, '.agents', 'skills', 'shared')
    writeFile(path.join(sharedSkill, 'SKILL.md'), skill('shared'))
    fs.mkdirSync(path.dirname(projectLink), { recursive: true })
    fs.symlinkSync(sharedSkill, projectLink)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.topLevelSkillCount, 1)
    assert.equal(report.summary.skillFileCount, 1)
    assert.equal(report.findings.some((finding: { code: string }) => finding.code === 'duplicate-skill-name'), false)
  })

  it.runIf(process.platform !== 'win32')('fails check mode for a broken top-level Skill symlink', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const link = path.join(projectRoot, '.agents', 'skills', 'broken')
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(path.join(tempDir, 'missing-skill'), link)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.findings[0].code, 'invalid-skill-symlink')
    assert.deepEqual(report.findings[0].paths, [link])
  })

  it.runIf(process.platform !== 'win32')('rejects a top-level symlink that does not point to a Skill entry', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const target = path.join(tempDir, 'not-a-skill')
    const link = path.join(projectRoot, '.agents', 'skills', 'unsafe')
    writeFile(path.join(target, 'nested', 'SKILL.md'), skill('nested'))
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.skillFileCount, 0)
    assert.equal(report.findings[0].code, 'invalid-skill-symlink')
    assert.deepEqual(report.findings[0].paths, [link])
  })

  it.runIf(process.platform !== 'win32')('bounds recursive discovery through a symbolic-link Skill', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    const target = path.join(tempDir, 'deep-skill')
    const link = path.join(projectRoot, '.agents', 'skills', 'deep')
    writeFile(path.join(target, 'SKILL.md'), skill('deep'))
    fs.mkdirSync(path.join(target, ...Array.from({ length: 34 }, (_, index) => `level-${index}`)), { recursive: true })
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.findings[0].code, 'skill-discovery-limit-exceeded')
  })

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)('fails check mode when a skill directory cannot be read', () => {
    tempDir = createTempDir('workstation-skills-')
    const homeRoot = path.join(tempDir, 'home')
    const projectRoot = path.join(tempDir, 'project')
    const skillsRoot = path.join(projectRoot, '.agents', 'skills')
    const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
    fs.mkdirSync(skillsRoot, { recursive: true })
    fs.chmodSync(skillsRoot, 0o000)

    const result = runCli(['skills', 'audit', '--project-root', projectRoot, '--check', '--json'], repoRoot, homeRoot)
    fs.chmodSync(skillsRoot, 0o755)

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout)
    assert.equal(report.summary.errorCount, 1)
    assert.equal(report.findings[0].code, 'unreadable-skill-directory')
  })
})
