---
layout: home

hero:
  name: Workstation
  text: Operating manual for a developer machine
  tagline: A repeatable workbench for fresh-machine bootstrap, dotfiles sync, software inventory, project layout, and daily checks.
  actions:
    - theme: brand
      text: Start Bootstrap
      link: /en/guide/bootstrap
    - theme: alt
      text: Commands
      link: /en/guide/commands
    - theme: alt
      text: 简体中文
      link: /

features:
  - title: Setup Pipeline
    details: Restore the machine in phases, from Homebrew and runtimes to workspace dependencies and dotfiles.
  - title: Sync Layer
    details: Manage shell, editor, and Codex configuration under HOME while masking local secrets in diffs.
  - title: Inventory
    details: Track tools, apps, install state, and official download links with Brewfiles and the software catalog.
  - title: Daily Ops
    details: Keep checks, dry-runs, project paths, and terminal conventions small enough to copy and rerun.
---

<div class="ws-home">
  <section class="ws-console" aria-label="Workstation status snapshot">
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
        <h2>Four Operating Lanes</h2>
      </div>
      <p>Each path keeps recovery and maintenance inspectable, reversible, and easy to rerun.</p>
    </div>
    <div class="ws-lanes">
      <a class="ws-lane" href="/en/guide/bootstrap">
        <span class="ws-lane-step">phase 01</span>
        <strong>Bootstrap</strong>
        <span>Install foundations, dependencies, and the CLI, then inspect writes with dry-run.</span>
      </a>
      <a class="ws-lane" href="/en/guide/dotfiles">
        <span class="ws-lane-step">phase 02</span>
        <strong>Sync Config</strong>
        <span>Map files from home/ back into HOME while keeping secrets local.</span>
      </a>
      <a class="ws-lane" href="/en/guide/software">
        <span class="ws-lane-step">phase 03</span>
        <strong>Inventory Apps</strong>
        <span>Review core tools, optional apps, and official downloads before installing.</span>
      </a>
      <a class="ws-lane" href="/en/guide/projects">
        <span class="ws-lane-step">phase 04</span>
        <strong>Place Projects</strong>
        <span>Use ghq-style paths so local checkouts stay close to their remote origins.</span>
      </a>
    </div>
  </section>

  <section class="ws-home-section">
    <div class="ws-section-head">
      <div>
        <p class="ws-section-kicker">System Map</p>
        <h2>Repository Modules</h2>
      </div>
      <p>Every directory owns a clear boundary so fresh-machine recovery has fewer guesses.</p>
    </div>
    <div class="ws-matrix">
      <div class="ws-map">
        <div class="ws-map-row"><code>home/</code><span>chezmoi-compatible source files for the home directory.</span></div>
        <div class="ws-map-row"><code>packages/cli</code><span>The workstation command for checks, diffs, push, pull, and project checkouts.</span></div>
        <div class="ws-map-row"><code>Brewfile</code><span>Terminal foundations and daily CLI tools.</span></div>
        <div class="ws-map-row"><code>Brewfile.apps</code><span>Optional desktop apps and Mac App Store entries.</span></div>
        <div class="ws-map-row"><code>docs/</code><span>Setup decisions, copyable commands, and recovery notes.</span></div>
      </div>
      <div class="ws-checks">
        <strong>Common Checks</strong>
        <a href="/en/guide/commands"><span>workstation dotfiles doctor</span><span>health</span></a>
        <a href="/en/guide/commands"><span>workstation dotfiles pull --dry-run</span><span>preview</span></a>
        <a href="/en/guide/software"><span>pnpm software:missing</span><span>inventory</span></a>
        <a href="/en/guide/packages"><span>brew bundle check</span><span>packages</span></a>
      </div>
    </div>
  </section>
</div>
