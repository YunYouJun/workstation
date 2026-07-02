export const brewfiles = {
  core: 'Brewfile',
  apps: 'Brewfile.apps',
} as const

export type BrewfileKind = keyof typeof brewfiles

export interface SoftwareItem {
  id: string
  name: string
  nameZh?: string
  /**
   * Official product or project site. Use downloadUrl when the install page is separate.
   */
  url: string
  app?: string
  aliases?: string[]
  bin?: string
  cask?: string
  defaultInstall?: boolean
  downloadUrl?: string
  favicon?: string
  iconColor?: string
  iconify?: string
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
        iconColor: '#fbb040',
        iconify: 'i-logos-homebrew',
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
        url: 'https://iterm2.com/',
        downloadUrl: 'https://iterm2.com/downloads.html',
        cask: 'iterm2',
        app: 'iTerm.app',
        iconColor: '#111827',
        iconify: 'i-simple-icons-iterm2',
      },
      {
        id: 'vscode',
        name: 'Visual Studio Code',
        url: 'https://code.visualstudio.com/',
        downloadUrl: 'https://code.visualstudio.com/download',
        cask: 'visual-studio-code',
        app: 'Visual Studio Code.app',
        iconColor: '#007acc',
        iconify: 'i-logos-visual-studio-code',
      },
      {
        id: 'cursor',
        name: 'Cursor',
        url: 'https://cursor.com/',
        downloadUrl: 'https://cursor.com/downloads',
        cask: 'cursor',
        app: 'Cursor.app',
        iconColor: '#111827',
        iconify: 'i-simple-icons-cursor',
      },
      {
        id: 'codex-cli',
        name: 'Codex CLI',
        url: 'https://developers.openai.com/codex/cli',
        cask: 'codex',
        bin: 'codex',
        iconColor: '#10a37f',
        iconify: 'i-logos-openai',
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
        iconColor: '#10a37f',
        iconify: 'i-logos-openai',
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
        url: 'https://www.raycast.com/',
        downloadUrl: 'https://www.raycast.com/download',
        cask: 'raycast',
        app: 'Raycast.app',
        iconColor: '#ff6363',
        iconify: 'i-simple-icons-raycast',
      },
      {
        id: 'chrome',
        name: 'Google Chrome',
        nameZh: '谷歌浏览器',
        url: 'https://www.google.com/chrome/',
        cask: 'google-chrome',
        app: 'Google Chrome.app',
        iconColor: '#4285f4',
        iconify: 'i-logos-chrome',
      },
      {
        id: 'firefox-dev',
        name: 'Firefox Developer Edition',
        nameZh: 'Firefox 开发者版',
        url: 'https://www.mozilla.org/firefox/developer/',
        cask: 'firefox@developer-edition',
        app: 'Firefox Developer Edition.app',
        iconColor: '#ff7139',
        iconify: 'i-logos-firefox',
      },
    ],
  },
  {
    group: 'Communication and media',
    items: [
      {
        id: 'neteasemusic',
        name: 'NetEase Cloud Music',
        nameZh: '网易云音乐',
        url: 'https://music.163.com/',
        cask: 'neteasemusic',
        app: 'NeteaseMusic.app',
        iconColor: '#d43c33',
        iconify: 'i-simple-icons-neteasecloudmusic',
      },
      {
        id: 'qq',
        name: 'QQ',
        url: 'https://im.qq.com/',
        downloadUrl: 'https://im.qq.com/index/#/macos',
        cask: 'qq',
        app: 'QQ.app',
        iconColor: '#12b7f5',
      },
      {
        id: 'wechat',
        name: 'WeChat',
        nameZh: '微信',
        url: 'https://weixin.qq.com/',
        downloadUrl: 'https://mac.weixin.qq.com/',
        cask: 'wechat',
        app: 'WeChat.app',
        iconColor: '#07c160',
        iconify: 'i-simple-icons-wechat',
      },
      {
        id: 'feishu',
        name: 'Feishu',
        nameZh: '飞书',
        url: 'https://www.feishu.cn/',
        downloadUrl: 'https://www.feishu.cn/download',
        cask: 'feishu',
        app: 'Feishu.app',
        iconColor: '#3370ff',
      },
    ],
  },
  {
    group: 'Containers',
    items: [
      {
        id: 'orbstack',
        name: 'OrbStack',
        url: 'https://orbstack.dev/',
        downloadUrl: 'https://orbstack.dev/download',
        cask: 'orbstack',
        app: 'OrbStack.app',
        iconColor: '#1d4ed8',
      },
      {
        id: 'docker',
        name: 'Docker Desktop',
        url: 'https://www.docker.com/',
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
        iconColor: '#2496ed',
        iconify: 'i-logos-docker-icon',
        note: 'Manual download link only; review Docker Desktop subscription terms before installing. OrbStack is the default container runtime.',
      },
    ],
  },
  {
    group: 'Developer utilities',
    items: [
      {
        id: 'termius',
        name: 'Termius',
        url: 'https://www.termius.com/',
        cask: 'termius',
        app: 'Termius.app',
        defaultInstall: false,
        iconColor: '#0f172a',
        note: 'Cross-platform SSH client. Keep as manual review because SSH config is usually machine- and account-specific.',
      },
      {
        id: 'cyberduck',
        name: 'Cyberduck',
        url: 'https://cyberduck.io/',
        downloadUrl: 'https://cyberduck.io/download/',
        cask: 'cyberduck',
        app: 'Cyberduck.app',
        defaultInstall: false,
        iconColor: '#f59e0b',
        note: 'SFTP and cloud storage browser. Install only when a machine needs GUI file transfer.',
      },
      {
        id: 'proxyman',
        name: 'Proxyman',
        url: 'https://proxyman.com/',
        downloadUrl: 'https://proxyman.com/download/',
        cask: 'proxyman',
        app: 'Proxyman.app',
        defaultInstall: false,
        iconColor: '#2563eb',
        note: 'HTTP debugging proxy for macOS and device debugging.',
      },
      {
        id: 'stats',
        name: 'Stats',
        url: 'https://github.com/exelban/stats',
        cask: 'stats',
        app: 'Stats.app',
        defaultInstall: false,
        iconColor: '#22c55e',
        note: 'Menu bar system monitor from the old macOS app note.',
      },
      {
        id: 'hiddenbar',
        name: 'Hidden Bar',
        url: 'https://github.com/dwarvesf/hidden',
        cask: 'hiddenbar',
        app: 'Hidden Bar.app',
        defaultInstall: false,
        iconColor: '#64748b',
        note: 'Menu bar item hider. Optional because it changes personal desktop layout.',
      },
      {
        id: 'xbar',
        name: 'xbar',
        url: 'https://xbarapp.com/',
        cask: 'xbar',
        app: 'xbar.app',
        defaultInstall: false,
        iconColor: '#111827',
        note: 'Runs scripts in the macOS menu bar. Archive-era BitBar replacement; install only when needed.',
      },
    ],
  },
  {
    group: 'Productivity',
    items: [
      {
        id: 'microsoft-todo',
        name: 'Microsoft To Do',
        nameZh: '微软待办',
        aliases: ['微软todo', '微软 todo', 'todo'],
        url: 'https://www.microsoft.com/en-us/microsoft-365/microsoft-to-do-list-app',
        downloadUrl: 'https://apps.apple.com/us/app/microsoft-to-do/id1274495053?mt=12',
        masId: 1274495053,
        app: 'Microsoft To Do.app',
        iconColor: '#2564cf',
        note: 'Mac App Store install. The mas CLI requires App Store sign-in.',
      },
      {
        id: '1password',
        name: '1Password',
        url: 'https://1password.com/',
        downloadUrl: 'https://1password.com/downloads/mac/',
        cask: '1password',
        app: '1Password.app',
        iconColor: '#0094f5',
        iconify: 'i-simple-icons-1password',
      },
      {
        id: 'obsidian',
        name: 'Obsidian',
        url: 'https://obsidian.md/',
        downloadUrl: 'https://obsidian.md/download',
        cask: 'obsidian',
        app: 'Obsidian.app',
        iconColor: '#7c3aed',
        iconify: 'i-logos-obsidian',
      },
      {
        id: 'notion',
        name: 'Notion',
        url: 'https://www.notion.com/',
        downloadUrl: 'https://www.notion.com/desktop',
        cask: 'notion',
        app: 'Notion.app',
        iconColor: '#111827',
        iconify: 'i-logos-notion',
      },
      {
        id: 'ima',
        name: 'ima.copilot',
        nameZh: '腾讯 ima',
        aliases: ['腾讯ima'],
        url: 'https://ima.qq.com/',
        downloadUrl: 'https://ima.qq.com/download',
        defaultInstall: false,
        favicon: 'https://static.ima.qq.com/ima/assets/chat/favicon.svg',
        iconColor: '#0052d9',
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
