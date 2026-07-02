---
layout: home

hero:
  name: Workstation
  text: 开发机器的运行手册
  tagline: 把新机器恢复、dotfiles 同步、软件清单、项目布局和日常检查整理成一个可审计的工作台。
  actions:
    - theme: brand
      text: 开始引导
      link: /guide/bootstrap
    - theme: alt
      text: 查看命令
      link: /guide/commands
    - theme: alt
      text: English
      link: /en/

features:
  - title: Setup Pipeline
    details: 从 Homebrew、运行时、仓库依赖到 dotfiles 应用，按阶段恢复机器。
  - title: Sync Layer
    details: 管理 HOME 中的 shell、编辑器和 Codex 配置，并在 diff 中遮蔽本地密钥。
  - title: Inventory
    details: 用 Brewfile、Brewfile.apps 和软件目录维护工具、应用与安装状态。
  - title: Daily Ops
    details: 把常用检查、dry-run、项目路径和终端约定整理成可复制操作。
---

<div class="ws-home">
  <section class="ws-console" aria-label="工作站状态快照">
    <div class="ws-console-head">
      <span class="ws-console-title">~/repos/github.com/YunYouJun/workstation</span>
      <span class="ws-console-state">ready</span>
    </div>
    <div class="ws-console-body">
      <div><span class="ws-prompt">$</span> workstation dotfiles doctor</div>
      <div><span class="ws-ok">ok</span> home/.zshrc tracked</div>
      <div><span class="ws-ok">ok</span> Code/User/settings.json tracked</div>
      <div><span class="ws-warn">note</span> run dry-run before touching HOME</div>
      <div class="ws-console-gap"></div>
      <div><span class="ws-prompt">$</span> pnpm software:missing</div>
      <div>review Brewfile.apps before installing optional desktop apps</div>
    </div>
  </section>

  <section class="ws-home-section">
    <div class="ws-section-head">
      <div>
        <p class="ws-section-kicker">Workflows</p>
        <h2>四条主线</h2>
      </div>
      <p>从恢复机器到日常维护，每条路径都保持可检查、可回滚、可重复。</p>
    </div>
    <div class="ws-lanes">
      <a class="ws-lane" href="/guide/bootstrap">
        <span class="ws-lane-step">phase 01</span>
        <strong>引导新机器</strong>
        <span>安装基础工具、依赖和 CLI，再用 dry-run 检查写入动作。</span>
      </a>
      <a class="ws-lane" href="/guide/dotfiles">
        <span class="ws-lane-step">phase 02</span>
        <strong>同步配置</strong>
        <span>把仓库里的 home/ 文件映射回 HOME，保留密钥边界。</span>
      </a>
      <a class="ws-lane" href="/guide/software">
        <span class="ws-lane-step">phase 03</span>
        <strong>整理软件</strong>
        <span>检查 core 工具、可选应用和官方下载入口，不把实验写进清单。</span>
      </a>
      <a class="ws-lane" href="/guide/projects">
        <span class="ws-lane-step">phase 04</span>
        <strong>放置项目</strong>
        <span>使用 ghq 风格路径，让本地 checkout 与远程来源保持一致。</span>
      </a>
    </div>
  </section>

  <section class="ws-home-section">
    <div class="ws-section-head">
      <div>
        <p class="ws-section-kicker">System Map</p>
        <h2>仓库模块</h2>
      </div>
      <p>每个目录只负责一个清楚边界，减少新机器恢复时的猜测。</p>
    </div>
    <div class="ws-matrix">
      <div class="ws-map">
        <div class="ws-map-row"><code>home/</code><span>chezmoi 兼容的 home 文件源。</span></div>
        <div class="ws-map-row"><code>packages/cli</code><span>workstation 命令，负责检查、diff、push、pull 和项目 checkout。</span></div>
        <div class="ws-map-row"><code>Brewfile</code><span>终端基础工具和每日 CLI。</span></div>
        <div class="ws-map-row"><code>Brewfile.apps</code><span>可选桌面应用与 Mac App Store 条目。</span></div>
        <div class="ws-map-row"><code>docs/</code><span>机器设置的决策、命令和恢复说明。</span></div>
      </div>
      <div class="ws-checks">
        <strong>常用检查</strong>
        <a href="/guide/commands"><span>workstation dotfiles doctor</span><span>health</span></a>
        <a href="/guide/commands"><span>workstation dotfiles pull --dry-run</span><span>preview</span></a>
        <a href="/guide/software"><span>pnpm software:missing</span><span>inventory</span></a>
        <a href="/guide/packages"><span>brew bundle check</span><span>packages</span></a>
      </div>
    </div>
  </section>
</div>
