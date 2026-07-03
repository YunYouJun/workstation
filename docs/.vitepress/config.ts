import type { DefaultTheme, UserConfig as VitePressUserConfig } from 'vitepress'
import { getViteConfig, getVitepressConfig } from '@yunyoujun/docs'
import { defineConfig } from 'vitepress'

const githubLink = 'https://github.com/YunYouJun/workstation'
const commonConfig = getVitepressConfig({ repo: githubLink })
const docsViteConfig = getViteConfig({
  componentsOptions: {
    dts: false,
  },
  vueDevTools: false,
}) as unknown as VitePressUserConfig['vite']
const commonHead = commonConfig.head?.filter(([tag, attrs]) => {
  return !(tag === 'link' && attrs.rel === 'icon')
})
const commonThemeConfig: DefaultTheme.Config = {
  ...commonConfig.themeConfig,
}
delete commonThemeConfig.logo

const enNav: DefaultTheme.NavItem[] = [
  { text: 'Home', link: '/en/' },
  {
    text: 'Setup',
    items: [
      { text: 'Repository Scope', link: '/en/guide/repository' },
      { text: 'Migration Index', link: '/en/guide/migration' },
      { text: 'Bootstrap Flow', link: '/en/guide/bootstrap' },
      { text: 'Copyable Commands', link: '/en/guide/commands' },
      { text: 'Packages', link: '/en/guide/packages' },
    ],
  },
  {
    text: 'Operate',
    items: [
      { text: 'Terminal', link: '/en/guide/terminal' },
      { text: 'Dotfiles Sync', link: '/en/guide/dotfiles' },
      { text: 'Secrets', link: '/en/guide/secrets' },
      { text: 'Projects', link: '/en/guide/projects' },
    ],
  },
  { text: 'Software', link: '/en/guide/software' },
  {
    text: 'Tools',
    items: [
      { text: 'VSCode Extensions', link: '/en/vscode/extensions' },
      { text: 'Codex Skills', link: '/en/guide/codex-skills' },
    ],
  },
]

const zhNav: DefaultTheme.NavItem[] = [
  { text: '首页', link: '/' },
  {
    text: '装机',
    items: [
      { text: '仓库范围', link: '/guide/repository' },
      { text: '迁移索引', link: '/guide/migration' },
      { text: '引导流程', link: '/guide/bootstrap' },
      { text: '可复制命令', link: '/guide/commands' },
      { text: '软件包', link: '/guide/packages' },
    ],
  },
  {
    text: '维护',
    items: [
      { text: '终端', link: '/guide/terminal' },
      { text: 'Dotfiles 同步', link: '/guide/dotfiles' },
      { text: '密钥', link: '/guide/secrets' },
      { text: '项目', link: '/guide/projects' },
    ],
  },
  { text: '软件', link: '/guide/software' },
  {
    text: '工具',
    items: [
      { text: 'VSCode 扩展', link: '/vscode/extensions' },
      { text: 'Codex Skills', link: '/guide/codex-skills' },
    ],
  },
]

const enSidebar: DefaultTheme.Sidebar = [
  {
    text: 'Start Here',
    items: [
      { text: 'Home', link: '/en/' },
      { text: 'Repository Scope', link: '/en/guide/repository' },
      { text: 'Migration Index', link: '/en/guide/migration' },
    ],
  },
  {
    text: 'Setup',
    items: [
      { text: 'Bootstrap Flow', link: '/en/guide/bootstrap' },
      { text: 'Copyable Commands', link: '/en/guide/commands' },
      { text: 'Packages', link: '/en/guide/packages' },
      { text: 'Software', link: '/en/guide/software' },
    ],
  },
  {
    text: 'Daily Ops',
    items: [
      { text: 'Terminal', link: '/en/guide/terminal' },
      { text: 'Dotfiles Sync', link: '/en/guide/dotfiles' },
      { text: 'Secrets', link: '/en/guide/secrets' },
      { text: 'Projects', link: '/en/guide/projects' },
    ],
  },
  {
    text: 'Toolbox',
    items: [
      { text: 'VSCode Extensions', link: '/en/vscode/extensions' },
      { text: 'Codex Skills', link: '/en/guide/codex-skills' },
    ],
  },
]

const zhSidebar: DefaultTheme.Sidebar = [
  {
    text: '起点',
    items: [
      { text: '首页', link: '/' },
      { text: '仓库范围', link: '/guide/repository' },
      { text: '迁移索引', link: '/guide/migration' },
    ],
  },
  {
    text: '装机流程',
    items: [
      { text: '引导流程', link: '/guide/bootstrap' },
      { text: '可复制命令', link: '/guide/commands' },
      { text: '软件包', link: '/guide/packages' },
      { text: '软件', link: '/guide/software' },
    ],
  },
  {
    text: '日常维护',
    items: [
      { text: '终端', link: '/guide/terminal' },
      { text: 'Dotfiles 同步', link: '/guide/dotfiles' },
      { text: '密钥', link: '/guide/secrets' },
      { text: '项目', link: '/guide/projects' },
    ],
  },
  {
    text: '工具箱',
    items: [
      { text: 'VSCode 扩展', link: '/vscode/extensions' },
      { text: 'Codex Skills', link: '/guide/codex-skills' },
    ],
  },
]

const enSearch: DefaultTheme.Config['search'] = {
  provider: 'local',
}

const zhSearch: DefaultTheme.Config['search'] = {
  provider: 'local',
  options: {
    translations: {
      button: {
        buttonText: '搜索',
        buttonAriaLabel: '搜索文档',
      },
      modal: {
        displayDetails: '显示详情',
        resetButtonTitle: '重置搜索',
        backButtonTitle: '关闭搜索',
        noResultsText: '没有找到相关结果',
        footer: {
          selectText: '选择',
          selectKeyAriaLabel: 'Enter 键',
          navigateText: '切换',
          navigateUpKeyAriaLabel: '上箭头',
          navigateDownKeyAriaLabel: '下箭头',
          closeText: '关闭',
          closeKeyAriaLabel: 'Escape 键',
        },
      },
    },
  },
}

const enThemeConfig: DefaultTheme.Config = {
  ...commonThemeConfig,
  nav: enNav,
  sidebar: enSidebar,
  search: enSearch,
  footer: {
    message: 'Personal workstation notes, scripts, and dotfiles.',
  },
}

const zhThemeConfig: DefaultTheme.Config = {
  ...commonThemeConfig,
  nav: zhNav,
  sidebar: zhSidebar,
  search: zhSearch,
  ...(commonThemeConfig.editLink
    ? {
        editLink: {
          ...commonThemeConfig.editLink,
          text: '在 GitHub 上编辑此页',
        },
      }
    : {}),
  footer: {
    message: '个人工作站笔记、脚本与 dotfiles。',
  },
  darkModeSwitchLabel: '深色模式',
  darkModeSwitchTitle: '切换到深色模式',
  docFooter: {
    prev: '上一页',
    next: '下一页',
  },
  langMenuLabel: '切换语言',
  lastUpdated: {
    text: '最后更新于',
  },
  lightModeSwitchTitle: '切换到浅色模式',
  outline: {
    level: [2, 4],
    label: '本页目录',
  },
  returnToTopLabel: '回到顶部',
  sidebarMenuLabel: '菜单',
  skipToContentLabel: '跳转到内容',
}

export default defineConfig({
  ...commonConfig,
  title: 'Workstation',
  description: '个人开发工作站引导、dotfiles、设置脚本与最佳实践。',
  head: commonHead,
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    ...commonConfig.markdown,
    codeCopyButtonTitle: '复制代码 / Copy Code',
  },
  themeConfig: commonThemeConfig,
  vite: docsViteConfig,
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: zhThemeConfig,
    },
    en: {
      label: 'English',
      lang: 'en-US',
      title: 'Workstation',
      description: 'Personal developer workstation bootstrap, dotfiles, setup scripts, and best practices.',
      themeConfig: enThemeConfig,
    },
  },
})
