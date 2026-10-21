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
  /** Verified native desktop platform support; omit when unknown. */
  platforms?: ('macos' | 'windows' | 'linux')[]
  /**
   * Official product or project site. Use downloadUrl when the install page is separate.
   */
  url: string
  app?: string
  aliases?: string[]
  bin?: string
  cask?: string
  /** Fixed Homebrew formula name. Never substitute installCommand into the software API. */
  formula?: string
  defaultInstall?: boolean
  downloadUrl?: string
  /** Official source repository, when the product publishes one. */
  repositoryUrl?: string
  /** Official application artwork, served as an image without recoloring. */
  iconUrl?: string
  /** Complete macOS application artwork, including its transparent margins and shadows. */
  macosIconUrl?: string
  /** Only opt full-bleed square website artwork into rounding. */
  iconStyle?: 'original' | 'rounded'
  /** Optical scale for the preferred artwork, compensating for its transparent canvas margins. */
  iconScale?: number
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
        platforms: ['macos', 'linux'],
        iconUrl: 'https://brew.sh/assets/img/homebrew.svg',
        name: {
          en: 'Homebrew',
        },
        url: 'https://brew.sh/',
        bin: 'brew',
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
        platforms: ['macos'],
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
        id: 'ghostty',
        platforms: ['macos', 'linux'],
        macosIconUrl: 'https://raw.githubusercontent.com/ghostty-org/ghostty/v1.3.1/macos/Assets.xcassets/AppIconImage.imageset/macOS-AppIcon-512px.png',
        iconUrl: 'https://ghostty.org/_next/static/media/ghostty-logo.6bcc6c33.svg',
        name: {
          en: 'Ghostty',
        },
        url: 'https://ghostty.org/',
        downloadUrl: 'https://ghostty.org/download',
        repositoryUrl: 'https://github.com/ghostty-org/ghostty',
        cask: 'ghostty',
        app: 'Ghostty.app',
        defaultInstall: false,
        note: 'Fast terminal emulator with native UI and GPU acceleration. Install with Homebrew or the official macOS download.',
      },
      {
        id: 'vscode',
        platforms: ['macos', 'windows', 'linux'],
        iconUrl: 'https://code.visualstudio.com/assets/apple-touch-icon.png',
        name: {
          en: 'Visual Studio Code',
        },
        url: 'https://code.visualstudio.com/',
        downloadUrl: 'https://code.visualstudio.com/download',
        repositoryUrl: 'https://github.com/microsoft/vscode',
        cask: 'visual-studio-code',
        app: 'Visual Studio Code.app',
        iconColor: '#007acc',
        iconify: 'i-logos-visual-studio-code',
      },
      {
        id: 'codex-cli',
        platforms: ['macos', 'windows', 'linux'],
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
        id: 'magpie',
        platforms: ['macos', 'windows', 'linux'],
        iconScale: 1.25,
        iconUrl: 'https://usemagpie.ai/img/icon-256.png',
        name: {
          en: 'magpie',
        },
        url: 'https://usemagpie.ai/',
        downloadUrl: 'https://github.com/yetone/magpie-releases/releases/latest',
        repositoryUrl: 'https://github.com/yetone/magpie',
        app: 'magpie.app',
        bin: 'magpie',
        defaultInstall: false,
        note: 'Manage the models and providers used by local AI agents from the menu bar. Download the native app from the official releases.',
      },
      {
        id: 'orca',
        platforms: ['macos', 'windows', 'linux'],
        iconScale: 1.24,
        macosIconUrl: 'https://raw.githubusercontent.com/stablyai/orca/1b9a408b8c0f7de5125f4bad8d89eb8419a29a88/resources/icon.png',
        iconStyle: 'rounded',
        iconUrl: 'https://www.onorca.dev/icon.png',
        name: {
          en: 'Orca',
        },
        url: 'https://www.onorca.dev/',
        downloadUrl: 'https://www.onorca.dev/docs/install',
        repositoryUrl: 'https://github.com/stablyai/orca',
        cask: 'stablyai/orca/orca',
        app: 'Orca.app',
        defaultInstall: false,
        note: 'Desktop workspace for running coding agents in parallel. Agent configuration and projects stay managed by Orca.',
      },
      {
        id: 'codebuddy-cn',
        platforms: ['macos', 'windows', 'linux'],
        iconUrl: 'https://download.codebuddy.cn/web/website/41d9f07cb6de7881ba06d46982d3876c0cbc1a98/assets/logo.svg',
        name: {
          en: 'CodeBuddy CN',
          zh: 'CodeBuddy 中国版',
        },
        url: 'https://www.codebuddy.cn/',
        downloadUrl: 'https://www.codebuddy.cn/downloads/',
        app: 'CodeBuddy CN.app',
        defaultInstall: false,
        note: 'CodeBuddy desktop IDE for the China region. Download from the official page.',
      },
      {
        id: 'codex',
        platforms: ['macos', 'windows', 'linux'],
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
        platforms: ['macos', 'windows'],
        iconUrl: 'https://www.raycast.com/favicon-production.png',
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
        platforms: ['macos', 'windows', 'linux'],
        iconUrl: 'https://www.google.com/chrome/static/images/favicons/android-icon-192x192.png',
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
        iconUrl: 'https://s1.music.126.net/style/favicon.ico?v20180823',
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
        platforms: ['macos', 'windows', 'linux'],
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
        iconUrl: 'https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico',
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
        platforms: ['macos', 'windows', 'linux'],
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
        iconUrl: 'https://cdn.weread.qq.com/web/wetype/favicon/icon-152.png',
        name: {
          en: 'WeType',
          zh: '微信输入法',
        },
        aliases: ['微信输入法', 'wechat input method'],
        url: 'https://z.weixin.qq.com/',
        inputMethod: 'WeType.app',
        iconColor: '#07c160',
        iconify: 'i-simple-icons-wechat',
        note: 'Install from the official WeChat Input Method site instead of Homebrew cask so the site controls the current macOS package. Enable it from macOS Keyboard settings after installation.',
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
        platforms: ['macos'],
        iconUrl: 'https://orbstack.dev/img/icon128.png',
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
        platforms: ['macos', 'windows', 'linux'],
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
        platforms: ['macos', 'windows', 'linux'],
        iconUrl: 'https://framerusercontent.com/images/RaVfXKUnfCfHvsZac7elxD7jVtc.png',
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
        platforms: ['macos', 'windows'],
        iconScale: 1.14,
        iconUrl: 'https://cdn.cyberduck.io/img/cyberduck-icon-rect-32.png',
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
        platforms: ['macos', 'windows', 'linux'],
        iconStyle: 'rounded',
        iconUrl: 'https://proxyman.com/favicon/apple-touch-icon.png?v=4',
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
        id: 'hiddenbar',
        platforms: ['macos'],
        iconScale: 1.02,
        iconUrl: 'https://raw.githubusercontent.com/dwarvesf/hidden/develop/img/icon_512%402x.png',
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
        id: 'thaw',
        platforms: ['macos'],
        macosIconUrl: 'https://www.getthaw.app/_next/static/immutable/media/thaw-icon.3ovi8zv9rpqo9.png',
        name: {
          en: 'Thaw',
        },
        url: 'https://www.getthaw.app/',
        downloadUrl: 'https://github.com/thaw-app/Thaw/releases',
        repositoryUrl: 'https://github.com/thaw-app/Thaw',
        cask: 'thaw',
        app: 'Thaw.app',
        defaultInstall: false,
        note: 'Free and open-source macOS menu bar manager. Hide and organize items, and show hidden items below the menu bar with Thaw Bar on Macs with a notch. Check the official download for macOS compatibility.',
      },
      {
        id: 'xbar',
        platforms: ['macos'],
        iconScale: 1.15,
        iconUrl: 'https://xbarapp.com/public/img/xbar-2048.png',
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
    id: 'game-development',
    label: {
      en: 'Game development',
      zh: '游戏开发',
    },
    items: [
      {
        id: 'godot',
        platforms: ['macos', 'windows', 'linux'],
        name: {
          en: 'Godot Engine',
          zh: 'Godot 游戏引擎',
        },
        url: 'https://godotengine.org/',
        downloadUrl: 'https://godotengine.org/download/macos/',
        repositoryUrl: 'https://github.com/godotengine/godot',
        iconUrl: 'https://godotengine.org/assets/press/icon_color.svg',
        cask: 'godot',
        app: 'Godot.app',
        bin: 'godot',
        defaultInstall: false,
        note: 'Free and open-source engine for 2D and 3D games. Install with Homebrew or the official macOS download.',
      },
    ],
  },
  {
    id: 'system-utilities',
    label: {
      en: 'System tools',
      zh: '系统工具',
    },
    items: [
      {
        id: 'stats',
        platforms: ['macos'],
        iconScale: 1.25,
        macosIconUrl: 'https://raw.githubusercontent.com/exelban/stats/88d5359ad3466efaa16985646a0bb15c6599109f/Stats/Supporting%20Files/Assets.xcassets/AppIcon.appiconset/icon_128x128.png',
        iconUrl: 'https://mac-stats.com/apple-touch-icon.png',
        name: {
          en: 'Stats',
        },
        url: 'https://github.com/exelban/stats',
        downloadUrl: 'https://github.com/exelban/stats/releases/latest',
        repositoryUrl: 'https://github.com/exelban/stats',
        cask: 'stats',
        app: 'Stats.app',
        defaultInstall: false,
        iconColor: '#22c55e',
        note: 'Open-source macOS menu bar monitor for CPU, memory, disk and network usage.',
      },
      {
        id: 'tencent-lemon',
        platforms: ['macos'],
        iconScale: 1.22,
        iconUrl: 'https://lemon.qq.com/images/lemon/logo.png',
        name: {
          en: 'Tencent Lemon Cleaner',
          zh: '腾讯柠檬清理',
        },
        aliases: ['腾讯柠檬', '柠檬清理', 'lemon cleaner'],
        url: 'https://lemon.qq.com/',
        downloadUrl: 'https://lemon.qq.com/',
        repositoryUrl: 'https://github.com/Tencent/lemon-cleaner',
        cask: 'tencent-lemon',
        app: 'Tencent Lemon.app',
        defaultInstall: false,
        iconColor: '#facc15',
        note: 'macOS cleanup and system status tool with application removal, large-file discovery and disk space analysis.',
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
        platforms: ['macos', 'windows'],
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
        platforms: ['macos', 'windows', 'linux'],
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
        platforms: ['macos', 'windows', 'linux'],
        iconStyle: 'rounded',
        iconUrl: 'https://obsidian.md/apple-touch-icon.png',
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
        platforms: ['macos', 'windows'],
        iconStyle: 'rounded',
        iconUrl: 'https://www.notion.com/front-static/logo-ios.png',
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
        platforms: ['macos', 'windows'],
        iconUrl: 'https://fe-static.ima.myqcloud.com/ima/assets/chat/favicon.svg',
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
