export const brewfiles = {
  core: 'Brewfile',
  apps: 'Brewfile.apps',
} as const

export type BrewfileKind = keyof typeof brewfiles

export interface LocalizedText {
  en: string
  zh?: string
}

export interface SoftwareItem {
  id: string
  name: LocalizedText
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
  inputMethod?: string
  masId?: number
  note?: string
}

export interface SoftwareGroup {
  id: string
  label: LocalizedText
  items: SoftwareItem[]
}

export interface SoftwareCatalogItem extends SoftwareItem {
  groupId: string
  groupLabel: LocalizedText
}

export const softwareGroups: SoftwareGroup[] = [
  {
    id: 'foundation',
    label: {
      en: 'Foundation',
      zh: '基础环境',
    },
    items: [
      {
        id: 'homebrew',
        name: {
          en: 'Homebrew',
        },
        url: 'https://brew.sh/',
        iconColor: '#fbb040',
        iconify: 'i-logos-homebrew',
        note: 'Install this manually before running Homebrew manifests.',
      },
    ],
  },
  {
    id: 'terminal-editor',
    label: {
      en: 'Terminal and editor',
      zh: '终端与编辑器',
    },
    items: [
      {
        id: 'iterm2',
        name: {
          en: 'iTerm2',
        },
        url: 'https://iterm2.com/',
        downloadUrl: 'https://iterm2.com/downloads.html',
        cask: 'iterm2',
        app: 'iTerm.app',
        iconColor: '#111827',
        iconify: 'i-simple-icons-iterm2',
      },
      {
        id: 'vscode',
        name: {
          en: 'Visual Studio Code',
        },
        url: 'https://code.visualstudio.com/',
        downloadUrl: 'https://code.visualstudio.com/download',
        cask: 'visual-studio-code',
        app: 'Visual Studio Code.app',
        iconColor: '#007acc',
        iconify: 'i-logos-visual-studio-code',
      },
      {
        id: 'cursor',
        name: {
          en: 'Cursor',
        },
        url: 'https://cursor.com/',
        downloadUrl: 'https://cursor.com/downloads',
        cask: 'cursor',
        app: 'Cursor.app',
        iconColor: '#111827',
        iconify: 'i-simple-icons-cursor',
      },
      {
        id: 'codex-cli',
        name: {
          en: 'Codex CLI',
        },
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
    id: 'ai-coding',
    label: {
      en: 'AI coding',
      zh: 'AI 编程',
    },
    items: [
      {
        id: 'codex',
        name: {
          en: 'Codex App',
        },
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
    id: 'launcher-browsers',
    label: {
      en: 'Launcher and browsers',
      zh: '启动器与浏览器',
    },
    items: [
      {
        id: 'raycast',
        name: {
          en: 'Raycast',
        },
        url: 'https://www.raycast.com/',
        downloadUrl: 'https://www.raycast.com/download',
        cask: 'raycast',
        app: 'Raycast.app',
        iconColor: '#ff6363',
        iconify: 'i-simple-icons-raycast',
      },
      {
        id: 'chrome',
        name: {
          en: 'Google Chrome',
          zh: '谷歌浏览器',
        },
        url: 'https://www.google.com/chrome/',
        cask: 'google-chrome',
        app: 'Google Chrome.app',
        iconColor: '#4285f4',
        iconify: 'i-logos-chrome',
      },
      {
        id: 'firefox-dev',
        name: {
          en: 'Firefox Developer Edition',
          zh: 'Firefox 开发者版',
        },
        url: 'https://www.mozilla.org/firefox/developer/',
        cask: 'firefox@developer-edition',
        app: 'Firefox Developer Edition.app',
        iconColor: '#ff7139',
        iconify: 'i-logos-firefox',
      },
    ],
  },
  {
    id: 'communication-media',
    label: {
      en: 'Communication and media',
      zh: '沟通与媒体',
    },
    items: [
      {
        id: 'neteasemusic',
        name: {
          en: 'NetEase Cloud Music',
          zh: '网易云音乐',
        },
        url: 'https://music.163.com/',
        cask: 'neteasemusic',
        app: 'NeteaseMusic.app',
        iconColor: '#d43c33',
        iconify: 'i-simple-icons-neteasecloudmusic',
      },
      {
        id: 'qq',
        name: {
          en: 'QQ',
        },
        url: 'https://im.qq.com/',
        downloadUrl: 'https://im.qq.com/index/#/macos',
        cask: 'qq',
        app: 'QQ.app',
        iconColor: '#12b7f5',
      },
      {
        id: 'wechat',
        name: {
          en: 'WeChat',
          zh: '微信',
        },
        url: 'https://weixin.qq.com/',
        downloadUrl: 'https://mac.weixin.qq.com/',
        cask: 'wechat',
        app: 'WeChat.app',
        iconColor: '#07c160',
        iconify: 'i-simple-icons-wechat',
      },
      {
        id: 'feishu',
        name: {
          en: 'Feishu',
          zh: '飞书',
        },
        url: 'https://www.feishu.cn/',
        downloadUrl: 'https://www.feishu.cn/download',
        cask: 'feishu',
        app: 'Feishu.app',
        iconColor: '#3370ff',
      },
    ],
  },
  {
    id: 'input-methods',
    label: {
      en: 'Input methods',
      zh: '输入法',
    },
    items: [
      {
        id: 'wetype',
        name: {
          en: 'WeType',
          zh: '微信输入法',
        },
        aliases: ['微信输入法', 'wechat input method'],
        url: 'https://z.weixin.qq.com/',
        cask: 'wetype',
        inputMethod: 'WeType.app',
        iconColor: '#07c160',
        iconify: 'i-simple-icons-wechat',
        note: 'Input method from the WeChat team. Enable it from macOS Keyboard settings after installation.',
      },
    ],
  },
  {
    id: 'containers',
    label: {
      en: 'Containers',
      zh: '容器',
    },
    items: [
      {
        id: 'orbstack',
        name: {
          en: 'OrbStack',
        },
        url: 'https://orbstack.dev/',
        downloadUrl: 'https://orbstack.dev/download',
        cask: 'orbstack',
        app: 'OrbStack.app',
        iconColor: '#1d4ed8',
      },
      {
        id: 'docker',
        name: {
          en: 'Docker Desktop',
        },
        url: 'https://www.docker.com/',
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
        iconColor: '#2496ed',
        iconify: 'i-logos-docker-icon',
        note: 'Manual download link only; review Docker Desktop subscription terms before installing. OrbStack is the default container runtime.',
      },
    ],
  },
  {
    id: 'developer-utilities',
    label: {
      en: 'Developer utilities',
      zh: '开发者工具',
    },
    items: [
      {
        id: 'termius',
        name: {
          en: 'Termius',
        },
        url: 'https://www.termius.com/',
        cask: 'termius',
        app: 'Termius.app',
        defaultInstall: false,
        iconColor: '#0f172a',
        note: 'Cross-platform SSH client. Keep as manual review because SSH config is usually machine- and account-specific.',
      },
      {
        id: 'cyberduck',
        name: {
          en: 'Cyberduck',
        },
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
        name: {
          en: 'Proxyman',
        },
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
        name: {
          en: 'Stats',
        },
        url: 'https://github.com/exelban/stats',
        cask: 'stats',
        app: 'Stats.app',
        defaultInstall: false,
        iconColor: '#22c55e',
        note: 'Menu bar system monitor from the old macOS app note.',
      },
      {
        id: 'hiddenbar',
        name: {
          en: 'Hidden Bar',
        },
        url: 'https://github.com/dwarvesf/hidden',
        cask: 'hiddenbar',
        app: 'Hidden Bar.app',
        defaultInstall: false,
        iconColor: '#64748b',
        note: 'Menu bar item hider. Optional because it changes personal desktop layout.',
      },
      {
        id: 'xbar',
        name: {
          en: 'xbar',
        },
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
    id: 'productivity',
    label: {
      en: 'Productivity',
      zh: '效率工具',
    },
    items: [
      {
        id: 'microsoft-todo',
        name: {
          en: 'Microsoft To Do',
          zh: '微软待办',
        },
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
        name: {
          en: '1Password',
        },
        url: 'https://1password.com/',
        downloadUrl: 'https://1password.com/downloads/mac/',
        cask: '1password',
        app: '1Password.app',
        iconColor: '#0094f5',
        iconify: 'i-simple-icons-1password',
      },
      {
        id: 'obsidian',
        name: {
          en: 'Obsidian',
        },
        url: 'https://obsidian.md/',
        downloadUrl: 'https://obsidian.md/download',
        cask: 'obsidian',
        app: 'Obsidian.app',
        iconColor: '#7c3aed',
        iconify: 'i-logos-obsidian',
      },
      {
        id: 'notion',
        name: {
          en: 'Notion',
        },
        url: 'https://www.notion.com/',
        downloadUrl: 'https://www.notion.com/desktop',
        cask: 'notion',
        app: 'Notion.app',
        iconColor: '#111827',
        iconify: 'i-logos-notion',
      },
      {
        id: 'ima',
        name: {
          en: 'ima.copilot',
          zh: '腾讯 ima',
        },
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
    groupId: group.id,
    groupLabel: group.label,
  })),
)
