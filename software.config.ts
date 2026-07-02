export const brewfiles = {
  core: 'Brewfile',
  apps: 'Brewfile.apps',
} as const

export type BrewfileKind = keyof typeof brewfiles

export interface SoftwareItem {
  id: string
  name: string
  url: string
  app?: string
  bin?: string
  cask?: string
  defaultInstall?: boolean
  installCommand?: string
  masId?: number
  note?: string
}

export interface SoftwareGroup {
  group: string
  items: SoftwareItem[]
}

export interface SoftwareCatalogItem extends SoftwareItem {
  group: string
}

export const softwareGroups: SoftwareGroup[] = [
  {
    group: 'Foundation',
    items: [
      {
        id: 'homebrew',
        name: 'Homebrew',
        url: 'https://brew.sh/',
        note: 'Install this manually before running Homebrew manifests.',
      },
    ],
  },
  {
    group: 'Terminal and editor',
    items: [
      {
        id: 'iterm2',
        name: 'iTerm2',
        url: 'https://iterm2.com/downloads.html',
        cask: 'iterm2',
        app: 'iTerm.app',
      },
      {
        id: 'vscode',
        name: 'Visual Studio Code',
        url: 'https://code.visualstudio.com/download',
        cask: 'visual-studio-code',
        app: 'Visual Studio Code.app',
      },
      {
        id: 'cursor',
        name: 'Cursor',
        url: 'https://cursor.com/downloads',
        cask: 'cursor',
        app: 'Cursor.app',
      },
      {
        id: 'codex-cli',
        name: 'Codex CLI',
        url: 'https://developers.openai.com/codex/cli',
        cask: 'codex',
        bin: 'codex',
        note: 'Terminal agent for repository work. The official OpenAI docs also list a standalone installer.',
      },
    ],
  },
  {
    group: 'AI coding',
    items: [
      {
        id: 'codex',
        name: 'Codex App',
        url: 'https://developers.openai.com/codex/app',
        cask: 'codex-app',
        app: 'Codex.app',
        note: 'Desktop command center for Codex agents.',
      },
    ],
  },
  {
    group: 'Launcher and browsers',
    items: [
      {
        id: 'raycast',
        name: 'Raycast',
        url: 'https://www.raycast.com/download',
        cask: 'raycast',
        app: 'Raycast.app',
      },
      {
        id: 'chrome',
        name: 'Google Chrome',
        url: 'https://www.google.com/chrome/',
        cask: 'google-chrome',
        app: 'Google Chrome.app',
      },
      {
        id: 'firefox-dev',
        name: 'Firefox Developer Edition',
        url: 'https://www.mozilla.org/firefox/developer/',
        cask: 'firefox@developer-edition',
        app: 'Firefox Developer Edition.app',
      },
    ],
  },
  {
    group: 'Communication and media',
    items: [
      {
        id: 'neteasemusic',
        name: 'NetEase Cloud Music',
        url: 'https://music.163.com/',
        cask: 'neteasemusic',
        app: 'NeteaseMusic.app',
      },
      {
        id: 'qq',
        name: 'QQ',
        url: 'https://im.qq.com/index/#/macos',
        cask: 'qq',
        app: 'QQ.app',
      },
      {
        id: 'wechat',
        name: 'WeChat',
        url: 'https://mac.weixin.qq.com/',
        cask: 'wechat',
        app: 'WeChat.app',
      },
      {
        id: 'feishu',
        name: 'Feishu',
        url: 'https://www.feishu.cn/download',
        cask: 'feishu',
        app: 'Feishu.app',
      },
    ],
  },
  {
    group: 'Containers',
    items: [
      {
        id: 'orbstack',
        name: 'OrbStack',
        url: 'https://orbstack.dev/download',
        cask: 'orbstack',
        app: 'OrbStack.app',
      },
      {
        id: 'docker',
        name: 'Docker Desktop',
        url: 'https://www.docker.com/products/docker-desktop/',
        note: 'Manual download link only; review Docker Desktop subscription terms before installing. OrbStack is the default container runtime.',
      },
    ],
  },
  {
    group: 'Productivity',
    items: [
      {
        id: 'microsoft-todo',
        name: 'Microsoft To Do',
        url: 'https://apps.apple.com/us/app/microsoft-to-do/id1274495053?mt=12',
        masId: 1274495053,
        app: 'Microsoft To Do.app',
        note: 'Mac App Store install. The mas CLI requires App Store sign-in.',
      },
      {
        id: '1password',
        name: '1Password',
        url: 'https://1password.com/downloads/mac/',
        cask: '1password',
        app: '1Password.app',
      },
      {
        id: 'obsidian',
        name: 'Obsidian',
        url: 'https://obsidian.md/download',
        cask: 'obsidian',
        app: 'Obsidian.app',
      },
      {
        id: 'notion',
        name: 'Notion',
        url: 'https://www.notion.com/desktop',
        cask: 'notion',
        app: 'Notion.app',
      },
      {
        id: 'ima',
        name: 'ima.copilot',
        url: 'https://ima.qq.com/download',
        defaultInstall: false,
        note: 'Tencent AI workspace. No Homebrew cask is currently available; download from the official page.',
      },
    ],
  },
]

export const softwareItems: SoftwareCatalogItem[] = softwareGroups.flatMap(group =>
  group.items.map(item => ({
    ...item,
    group: group.group,
  })),
)
