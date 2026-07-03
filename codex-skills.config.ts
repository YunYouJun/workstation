export interface GitHubCodexSkillSource {
  type: 'github'
  repo: string
  path: string
  ref?: string
}

export interface CodexSkill {
  id: string
  description: string
  source: GitHubCodexSkillSource
  targetName?: string
}

export const codexSkills: CodexSkill[] = [
  {
    id: 'ui-ux-pro-max',
    targetName: 'ui-ux-pro-max',
    description: 'Broad UI/UX design intelligence for web, mobile, dashboards, landing pages, and component review.',
    source: {
      type: 'github',
      repo: 'nextlevelbuilder/ui-ux-pro-max-skill',
      path: '.claude/skills/ui-ux-pro-max',
      ref: 'main',
    },
  },
]
