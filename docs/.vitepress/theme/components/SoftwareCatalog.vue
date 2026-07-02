<script setup>
import { useData } from 'vitepress'
import { computed, ref } from 'vue'
import { softwareGroups } from '../../../../software.config'

const { localeIndex } = useData()
const query = ref('')
const selectedGroup = ref('all')
const installableOnly = ref(false)
const copiedKey = ref('')

const messages = {
  en: {
    all: 'All',
    catalogLabel: 'Software catalog',
    copied: 'Copied',
    copyDefaultInstalls: 'Copy default installs',
    copyFailed: 'Copy failed. Select the command from the page and copy it manually.',
    copyInstall: 'Copy install',
    copyOpen: 'Copy open',
    copyOpenCommand: 'Copy open command',
    download: 'Download',
    inBrewfileApps: 'in Brewfile.apps',
    installableOnly: 'Scriptable install',
    manualBootstrap: 'manual bootstrap',
    manualReview: 'manual review',
    noMatch: 'No software matched.',
    openVisible: 'Open visible',
    scriptInstaller: 'script installer',
    searchLabel: 'Search software',
    searchPlaceholder: 'Search software, id, cask, or category',
    tabsLabel: 'Software categories',
    shown: count => `${count} shown`,
  },
  zh: {
    all: '全部',
    catalogLabel: '软件目录',
    copied: '已复制',
    copyDefaultInstalls: '复制默认安装命令',
    copyFailed: '复制失败。请在页面中选中命令后手动复制。',
    copyInstall: '复制安装命令',
    copyOpen: '复制打开命令',
    copyOpenCommand: '复制打开命令',
    download: '下载',
    inBrewfileApps: '已在 Brewfile.apps 中',
    installableOnly: '仅显示可脚本安装',
    manualBootstrap: '手动初始化',
    manualReview: '需手动确认',
    noMatch: '没有匹配的软件。',
    openVisible: '打开当前结果',
    scriptInstaller: '脚本安装器',
    searchLabel: '搜索软件',
    searchPlaceholder: '搜索软件、id、cask 或分类',
    tabsLabel: '软件分类',
    shown: count => `已显示 ${count} 项`,
  },
}

const t = computed(() => messages[localeIndex.value === 'en' ? 'en' : 'zh'])

const groupOptions = computed(() => [
  {
    id: 'all',
    label: t.value.all,
    count: softwareGroups.reduce((total, group) => total + group.items.length, 0),
  },
  ...softwareGroups.map(group => ({
    id: group.group,
    label: group.group,
    count: group.items.length,
  })),
])

const normalizedQuery = computed(() => query.value.trim().toLowerCase())

const visibleGroups = computed(() => {
  return softwareGroups
    .map((group) => {
      const items = group.items.filter(item => matchesItem(item, group.group))
      return {
        ...group,
        items,
      }
    })
    .filter(group => group.items.length > 0)
})

const visibleItems = computed(() => visibleGroups.value.flatMap(group =>
  group.items.map(item => ({
    ...item,
    group: group.group,
  })),
))

const defaultInstallItems = computed(() => visibleItems.value.filter(item =>
  item.defaultInstall !== false && installCommand(item),
))

const openVisibleCommand = computed(() => {
  if (visibleItems.value.length === 0)
    return ''

  return `pnpm software:open ${visibleItems.value.map(item => item.id).join(' ')}`
})

const installVisibleCommand = computed(() => {
  if (defaultInstallItems.value.length === 0)
    return ''

  const casks = defaultInstallItems.value.filter(item => item.cask).map(item => item.cask)
  const masItems = defaultInstallItems.value.filter(item => item.masId)
  const customCommands = defaultInstallItems.value
    .filter(item => item.installCommand)
    .map(item => item.installCommand)
  const commands = []

  if (casks.length > 0)
    commands.push(`brew install --cask ${casks.join(' ')}`)

  if (masItems.length > 0) {
    commands.push('brew install mas')
    commands.push(...masItems.map(item => `mas install ${item.masId}`))
  }

  commands.push(...customCommands)

  return commands.join('\n')
})

function matchesItem(item, groupName) {
  if (selectedGroup.value !== 'all' && groupName !== selectedGroup.value)
    return false

  if (installableOnly.value && !installCommand(item))
    return false

  if (!normalizedQuery.value)
    return true

  return [
    item.id,
    item.name,
    item.url,
    item.cask,
    item.masId?.toString(),
    item.installCommand,
    item.note,
    groupName,
  ]
    .filter(Boolean)
    .some(value => value.toLowerCase().includes(normalizedQuery.value))
}

function installCommand(item) {
  if (item.cask)
    return `brew install --cask ${item.cask}`

  if (item.masId)
    return `mas install ${item.masId}`

  return item.installCommand ?? ''
}

function installKindLabel(item) {
  if (item.cask)
    return `cask: ${item.cask}`

  if (item.masId)
    return `mas: ${item.masId}`

  if (item.installCommand)
    return t.value.scriptInstaller

  return t.value.manualBootstrap
}

function installStatusLabel(item) {
  if (item.defaultInstall === false)
    return t.value.manualReview

  if (item.cask || item.masId)
    return t.value.inBrewfileApps

  return ''
}

function openVisible() {
  if (typeof window === 'undefined')
    return

  for (const item of visibleItems.value)
    window.open(item.url, '_blank', 'noopener,noreferrer')
}

async function copyText(text, key) {
  if (!text)
    return

  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
    }
    else {
      const input = document.createElement('textarea')
      input.value = text
      input.setAttribute('readonly', '')
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }

    copiedKey.value = key
    window.setTimeout(() => {
      if (copiedKey.value === key)
        copiedKey.value = ''
    }, 1600)
  }
  catch {
    copiedKey.value = 'failed'
  }
}
</script>

<template>
  <section class="software-catalog" :aria-label="t.catalogLabel">
    <div class="software-toolbar">
      <label class="software-search">
        <span class="visually-hidden">{{ t.searchLabel }}</span>
        <input
          v-model="query"
          type="search"
          :placeholder="t.searchPlaceholder"
        >
      </label>

      <label class="software-toggle">
        <input v-model="installableOnly" type="checkbox">
        <span>{{ t.installableOnly }}</span>
      </label>
    </div>

    <div class="software-tabs" role="tablist" :aria-label="t.tabsLabel">
      <button
        v-for="group in groupOptions"
        :key="group.id"
        class="software-tab"
        :class="{ active: selectedGroup === group.id }"
        type="button"
        role="tab"
        :aria-selected="selectedGroup === group.id"
        @click="selectedGroup = group.id"
      >
        <span>{{ group.label }}</span>
        <span class="software-tab-count">{{ group.count }}</span>
      </button>
    </div>

    <div class="software-actions">
      <button
        type="button"
        :disabled="!openVisibleCommand"
        @click="copyText(openVisibleCommand, 'open-visible')"
      >
        {{ copiedKey === 'open-visible' ? t.copied : t.copyOpenCommand }}
      </button>
      <button
        type="button"
        :disabled="!installVisibleCommand"
        @click="copyText(installVisibleCommand, 'install-visible')"
      >
        {{ copiedKey === 'install-visible' ? t.copied : t.copyDefaultInstalls }}
      </button>
      <button
        type="button"
        :disabled="visibleItems.length === 0"
        @click="openVisible"
      >
        {{ t.openVisible }}
      </button>
      <span class="software-result-count">{{ t.shown(visibleItems.length) }}</span>
    </div>

    <p v-if="copiedKey === 'failed'" class="software-copy-status">
      {{ t.copyFailed }}
    </p>

    <div v-if="visibleItems.length === 0" class="software-empty">
      {{ t.noMatch }}
    </div>

    <section
      v-for="group in visibleGroups"
      :key="group.group"
      class="software-group"
    >
      <div class="software-group-header">
        <h3>{{ group.group }}</h3>
        <span>{{ group.items.length }}</span>
      </div>

      <ul class="software-list">
        <li v-for="item in group.items" :key="item.id" class="software-item">
          <div class="software-item-main">
            <div class="software-item-title">
              <strong>{{ item.name }}</strong>
              <code>{{ item.id }}</code>
            </div>

            <div class="software-meta">
              <span>{{ installKindLabel(item) }}</span>
              <span v-if="installStatusLabel(item)">{{ installStatusLabel(item) }}</span>
            </div>

            <p v-if="item.note" class="software-note">
              {{ item.note }}
            </p>
          </div>

          <div class="software-item-actions">
            <a :href="item.url" target="_blank" rel="noreferrer">
              {{ t.download }}
            </a>
            <button
              type="button"
              @click="copyText(`pnpm software:open ${item.id}`, `${item.id}-open`)"
            >
              {{ copiedKey === `${item.id}-open` ? t.copied : t.copyOpen }}
            </button>
            <button
              v-if="installCommand(item)"
              type="button"
              @click="copyText(installCommand(item), `${item.id}-install`)"
            >
              {{ copiedKey === `${item.id}-install` ? t.copied : t.copyInstall }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.software-catalog {
  display: grid;
  gap: 16px;
  margin: 24px 0 32px;
}

.software-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.software-search input {
  width: 100%;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  font: inherit;
}

.software-search input:focus {
  border-color: var(--vp-c-brand-1);
  outline: 2px solid color-mix(in srgb, var(--vp-c-brand-1), transparent 74%);
}

.software-toggle {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  background: var(--vp-c-bg-soft);
}

.software-tabs,
.software-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.software-tab,
.software-actions button,
.software-item-actions button,
.software-item-actions a {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  font: inherit;
  line-height: 32px;
  text-decoration: none;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    color 0.16s ease,
    background-color 0.16s ease;
}

.software-tab {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.software-tab:hover,
.software-actions button:hover:not(:disabled),
.software-item-actions button:hover,
.software-item-actions a:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.software-tab.active,
.software-item-actions a {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-button-brand-text);
  background: var(--vp-c-brand-1);
}

.software-tab.active:hover,
.software-item-actions a:hover {
  color: var(--vp-button-brand-text);
  background: var(--vp-c-brand-2);
}

.software-tab-count {
  color: inherit;
  opacity: 0.74;
}

.software-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.software-result-count,
.software-copy-status,
.software-empty,
.software-note,
.software-meta {
  color: var(--vp-c-text-2);
}

.software-result-count {
  margin-left: auto;
  font-size: 13px;
}

.software-copy-status,
.software-empty {
  margin: 0;
  font-size: 14px;
}

.software-group {
  display: grid;
  gap: 10px;
}

.software-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.software-group-header h3 {
  margin: 0;
  font-size: 18px;
}

.software-group-header span {
  color: var(--vp-c-text-3);
  font-size: 13px;
}

.software-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.software-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}

.software-item-main {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.software-item-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.software-item-title strong {
  color: var(--vp-c-text-1);
}

.software-item-title code {
  color: var(--vp-c-text-2);
  font-size: 12px;
}

.software-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
}

.software-meta span {
  padding: 2px 7px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
}

.software-note {
  margin: 0;
  font-size: 13px;
}

.software-item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.visually-hidden {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (max-width: 720px) {
  .software-toolbar,
  .software-item {
    grid-template-columns: 1fr;
  }

  .software-toggle {
    justify-content: flex-start;
  }

  .software-result-count {
    width: 100%;
    margin-left: 0;
  }

  .software-item-actions {
    justify-content: flex-start;
  }
}
</style>
