<script setup>
import { useData } from 'vitepress'
import { computed, ref } from 'vue'
import { softwareGroups } from '../../../../software.config'

const { localeIndex } = useData()
const query = ref('')
const selectedGroup = ref('all')
const installableOnly = ref(false)
const copiedKey = ref('')
const loadedFaviconIds = ref([])
const failedFaviconIds = ref([])

const messages = {
  en: {
    all: 'All',
    catalogLabel: 'Software catalog',
    copied: 'Copied',
    copyDefaultInstalls: 'Copy install commands',
    copyFailed: 'Copy failed. Select the command from the page and copy it manually.',
    copyInstall: 'Copy install',
    inBrewfileApps: 'in Brewfile.apps',
    installableOnly: 'Scriptable install',
    manualBootstrap: 'manual bootstrap',
    manualReview: 'manual review',
    noMatch: 'No software matched.',
    downloadPage: 'Download',
    officialSite: 'Official site',
    openDownloadPage: name => `Open ${name} download page`,
    openOfficialSite: name => `Open ${name} official site`,
    openVisibleDownloads: count => `Open ${count} download ${count === 1 ? 'page' : 'pages'}`,
    scriptInstaller: 'script installer',
    searchLabel: 'Search software',
    searchPlaceholder: 'Search software, id, cask, or category',
    tabsLabel: 'Software categories',
    terminalTitle: 'pnpm software list',
    shown: (count, total) => `${count}/${total} shown`,
  },
  zh: {
    all: '全部',
    catalogLabel: '软件目录',
    copied: '已复制',
    copyDefaultInstalls: '复制安装命令',
    copyFailed: '复制失败。请在页面中选中命令后手动复制。',
    copyInstall: '复制安装命令',
    inBrewfileApps: '已在 Brewfile.apps 中',
    installableOnly: '仅显示可脚本安装',
    manualBootstrap: '手动初始化',
    manualReview: '需手动确认',
    noMatch: '没有匹配的软件。',
    downloadPage: '下载页',
    officialSite: '官方站点',
    openDownloadPage: name => `打开 ${name} 下载页`,
    openOfficialSite: name => `打开 ${name} 官方站点`,
    openVisibleDownloads: count => `打开当前 ${count} 个下载页`,
    scriptInstaller: '脚本安装器',
    searchLabel: '搜索软件',
    searchPlaceholder: '搜索软件、id、cask 或分类',
    tabsLabel: '软件分类',
    terminalTitle: 'pnpm software list',
    shown: (count, total) => `${count}/${total} 项`,
  },
}

const activeLocale = computed(() => localeIndex.value === 'en' ? 'en' : 'zh')
const t = computed(() => messages[activeLocale.value])

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
const queryTokens = computed(() => normalizedQuery.value.split(/[\s,，]+/).filter(Boolean))
const totalItems = computed(() => softwareGroups.reduce((total, group) => total + group.items.length, 0))

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

  if (queryTokens.value.length === 0)
    return true

  const searchableValues = [
    item.id,
    item.name,
    item.nameZh,
    item.url,
    item.downloadUrl,
    ...(item.aliases ?? []),
    item.cask,
    item.masId?.toString(),
    item.installCommand,
    item.note,
    groupName,
  ]
    .filter(Boolean)

  return queryTokens.value.some(token =>
    searchableValues.some(value => value.toLowerCase().includes(token)),
  )
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

function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  }
  catch {
    return url
  }
}

function downloadUrl(item) {
  return item.downloadUrl || item.url
}

function hasSeparateDownloadUrl(item) {
  return Boolean(item.downloadUrl && item.downloadUrl !== item.url)
}

function displayName(item) {
  if (activeLocale.value === 'zh' && item.nameZh)
    return item.nameZh

  return item.name
}

function secondaryName(item) {
  const primaryName = displayName(item)
  return primaryName === item.name ? '' : item.name
}

function fallbackIconLabel(item) {
  const compactName = displayName(item).replace(/\s+/g, '')

  if (/[\u4E00-\u9FFF]/.test(compactName))
    return Array.from(compactName).slice(0, 2).join('')

  return displayName(item)
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function faviconUrl(item) {
  if (item.favicon)
    return item.favicon

  try {
    return new URL('/favicon.ico', item.url).toString()
  }
  catch {
    return ''
  }
}

function shouldLoadFavicon(item) {
  return Boolean(!item.iconify && faviconUrl(item) && !failedFaviconIds.value.includes(item.id))
}

function hasLoadedFavicon(item) {
  return loadedFaviconIds.value.includes(item.id)
}

function markFaviconLoaded(item) {
  if (!loadedFaviconIds.value.includes(item.id))
    loadedFaviconIds.value = [...loadedFaviconIds.value, item.id]
}

function markFaviconFailed(item) {
  if (!failedFaviconIds.value.includes(item.id))
    failedFaviconIds.value = [...failedFaviconIds.value, item.id]
}

function openVisible() {
  if (typeof window === 'undefined')
    return

  for (const item of visibleItems.value)
    window.open(downloadUrl(item), '_blank', 'noopener,noreferrer')
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
    <span
      class="software-icon-preset-safelist i-logos-homebrew i-simple-icons-iterm2 i-logos-visual-studio-code i-simple-icons-cursor i-logos-openai i-simple-icons-raycast i-logos-chrome i-logos-firefox i-simple-icons-neteasecloudmusic i-simple-icons-wechat i-logos-docker-icon i-simple-icons-1password i-logos-obsidian i-logos-notion"
      aria-hidden="true"
    />

    <div class="software-console">
      <div class="software-console-header">
        <span class="software-window-controls" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span class="software-console-title">
          <span class="software-prompt" aria-hidden="true">$</span>
          {{ t.terminalTitle }}
        </span>
        <span class="software-console-status">{{ t.shown(visibleItems.length, totalItems) }}</span>
      </div>

      <div class="software-console-body">
        <div class="software-toolbar">
          <label class="software-search">
            <span class="visually-hidden">{{ t.searchLabel }}</span>
            <span class="software-search-prompt" aria-hidden="true">grep</span>
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
            class="software-primary-action"
            type="button"
            :disabled="visibleItems.length === 0"
            @click="openVisible"
          >
            {{ t.openVisibleDownloads(visibleItems.length) }}
          </button>
          <button
            type="button"
            :disabled="!installVisibleCommand"
            @click="copyText(installVisibleCommand, 'install-visible')"
          >
            {{ copiedKey === 'install-visible' ? t.copied : t.copyDefaultInstalls }}
          </button>
        </div>

        <p v-if="copiedKey === 'failed'" class="software-copy-status">
          {{ t.copyFailed }}
        </p>

        <div v-if="visibleItems.length === 0" class="software-empty">
          {{ t.noMatch }}
        </div>
      </div>
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
        <li
          v-for="item in group.items"
          :key="item.id"
          class="software-item"
          :style="{ '--software-icon-color': item.iconColor || 'var(--vp-c-brand-1)' }"
        >
          <div class="software-icon" aria-hidden="true">
            <span
              v-if="item.iconify"
              class="software-iconify"
              :class="item.iconify"
            />
            <img
              v-else-if="shouldLoadFavicon(item)"
              :src="faviconUrl(item)"
              :class="{ loaded: hasLoadedFavicon(item) }"
              alt=""
              loading="lazy"
              decoding="async"
              @load="markFaviconLoaded(item)"
              @error="markFaviconFailed(item)"
            >
            <span
              class="software-fallback-label"
              :class="{ hidden: item.iconify || hasLoadedFavicon(item) }"
            >
              {{ fallbackIconLabel(item) }}
            </span>
          </div>

          <div class="software-item-main">
            <div class="software-item-title">
              <strong>{{ displayName(item) }}</strong>
              <span v-if="secondaryName(item)" class="software-name-alias">{{ secondaryName(item) }}</span>
              <code>{{ item.id }}</code>
            </div>
            <span class="software-domain">{{ displayHost(item.url) }}</span>

            <div class="software-meta">
              <span>{{ installKindLabel(item) }}</span>
              <span v-if="installStatusLabel(item)">{{ installStatusLabel(item) }}</span>
            </div>

            <p v-if="item.note" class="software-note">
              {{ item.note }}
            </p>
          </div>

          <div class="software-item-actions">
            <a
              class="software-download-link"
              :href="downloadUrl(item)"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="hasSeparateDownloadUrl(item) ? t.openDownloadPage(displayName(item)) : t.openOfficialSite(displayName(item))"
            >
              <span class="software-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M10 6h8v8" />
                  <path d="M18 6 9 15" />
                  <path d="M16 16v2H6V8h2" />
                </svg>
              </span>
              {{ hasSeparateDownloadUrl(item) ? t.downloadPage : t.officialSite }}
            </a>
            <a
              v-if="hasSeparateDownloadUrl(item)"
              class="software-official-link"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t.openOfficialSite(displayName(item))"
            >
              {{ t.officialSite }}
            </a>
            <button
              v-if="installCommand(item)"
              type="button"
              @click="copyText(installCommand(item), `${item.id}-install`)"
            >
              <span class="software-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <rect x="8" y="8" width="10" height="10" rx="2" />
                  <path d="M6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
                </svg>
              </span>
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
  gap: 18px;
  margin: 24px 0 32px;
}

.software-icon-preset-safelist {
  display: none;
}

.software-console {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1), var(--vp-c-divider) 58%);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  box-shadow: 0 16px 42px rgba(15, 23, 42, 0.08);
}

.software-console-header {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 44px;
  padding: 0 14px;
  color: #d1fae5;
  background: #101418;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}

.software-window-controls {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.software-window-controls span {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.software-window-controls span:nth-child(1) {
  background: #ef4444;
}

.software-window-controls span:nth-child(2) {
  background: #f59e0b;
}

.software-window-controls span:nth-child(3) {
  background: #14b8a6;
}

.software-console-title {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
  color: #ecfeff;
  overflow-wrap: anywhere;
}

.software-prompt {
  color: #5eead4;
  font-weight: 700;
}

.software-console-status {
  margin-left: auto;
  padding: 3px 8px;
  border: 1px solid rgba(94, 234, 212, 0.24);
  border-radius: 6px;
  color: #a7f3d0;
  background: rgba(20, 184, 166, 0.12);
  white-space: nowrap;
}

.software-console-body {
  display: grid;
  gap: 12px;
  padding: 14px;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--vp-c-brand-soft), transparent 40%),
      transparent 70%
    ),
    var(--vp-c-bg-soft);
}

.software-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.software-search {
  position: relative;
  display: block;
}

.software-search-prompt {
  position: absolute;
  top: 50%;
  left: 12px;
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 700;
  pointer-events: none;
  transform: translateY(-50%);
}

.software-search input {
  width: 100%;
  min-height: 42px;
  padding: 0 12px 0 58px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.4;
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
  font-size: 13px;
  white-space: nowrap;
  background: var(--vp-c-bg);
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
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
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
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
}

.software-tab:hover,
.software-actions button:hover:not(:disabled),
.software-item-actions button:hover,
.software-item-actions a:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.software-tab.active,
.software-actions .software-primary-action,
.software-item-actions .software-download-link {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-button-brand-text);
  background: var(--vp-c-brand-1);
}

.software-tab.active:hover,
.software-actions .software-primary-action:hover:not(:disabled),
.software-item-actions .software-download-link:hover {
  color: var(--vp-button-brand-text);
  background: var(--vp-c-brand-2);
}

.software-tab-count {
  color: inherit;
  opacity: 0.74;
}

.software-actions button:disabled,
.software-item-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.software-copy-status,
.software-empty,
.software-note,
.software-meta,
.software-domain {
  color: var(--vp-c-text-2);
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
  letter-spacing: 0;
}

.software-group-header h3::before {
  content: '>';
  margin-right: 8px;
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-mono);
  font-size: 16px;
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
  grid-template-columns: 46px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 13px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  box-shadow:
    inset 3px 0 0 var(--software-icon-color),
    0 1px 0 rgba(15, 23, 42, 0.02);
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.software-item:hover {
  border-color: color-mix(in srgb, var(--software-icon-color), var(--vp-c-divider) 54%);
  box-shadow:
    inset 3px 0 0 var(--software-icon-color),
    0 12px 28px rgba(15, 23, 42, 0.07);
  transform: translateY(-1px);
}

.software-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid color-mix(in srgb, var(--software-icon-color), white 66%);
  border-radius: 8px;
  color: var(--software-icon-color);
  background: color-mix(in srgb, var(--software-icon-color), white 86%);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 800;
  overflow: hidden;
}

.software-icon img,
.software-iconify {
  position: absolute;
  display: block;
  width: 22px;
  height: 22px;
}

.software-icon img {
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.software-icon img.loaded {
  opacity: 1;
}

.software-iconify {
  color: var(--software-icon-color);
  font-size: 22px;
}

.software-fallback-label {
  transition: opacity 0.16s ease;
}

.software-fallback-label.hidden {
  opacity: 0;
}

.software-item-main {
  display: grid;
  gap: 5px;
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
  font-size: 15px;
  line-height: 1.35;
}

.software-name-alias {
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.35;
}

.software-item-title code {
  color: var(--vp-c-text-2);
  font-size: 12px;
}

.software-domain {
  overflow: hidden;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.software-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
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
  line-height: 1.55;
}

.software-item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.software-item-actions a,
.software-item-actions button,
.software-actions button {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.software-action-icon {
  display: inline-grid;
  place-items: center;
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.software-action-icon svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
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

  .software-console-header {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 10px 12px;
  }

  .software-console-status {
    margin-left: 0;
  }

  .software-toggle {
    justify-content: flex-start;
  }

  .software-item-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  .software-console-body {
    padding: 12px;
  }

  .software-item {
    grid-template-columns: 44px minmax(0, 1fr);
    align-items: start;
  }

  .software-icon {
    width: 38px;
    height: 38px;
  }

  .software-item-actions {
    grid-column: 1 / -1;
    padding-left: 52px;
  }
}
</style>
