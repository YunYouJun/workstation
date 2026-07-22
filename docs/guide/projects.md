# 项目

项目 checkout 自动化应该显式且安全。公开的工作站仓库可以描述通用结构，但不应暴露私有工作。

## 标准布局

本地 checkout 使用 `ghq` 的目录模型：

```text
~/repos/github.com/YunYouJun/workstation
```

每台机器只需配置一次 `ghq`：

```bash
git config --global ghq.root ~/repos
```

确认当前配置：

```bash
git config --global --get ghq.root
```

尽可能通过 `ghq` clone 仓库：

```bash
ghq get git@github.com:YunYouJun/workstation.git
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

这样本地路径会接近远程 URL，也避免 `~/repos/gh/yyj` 这类私有简称。

## 临时实验区

临时 demo、一次性试验和随时可删除的样例可以放在：

```text
~/repos/play/<demo-name>
```

`~/repos/play` 只作为本机实验区，不承载长期维护的正式 checkout。这里的内容默认
视为可丢弃；如果 demo 演进成需要保留的仓库，再用 `ghq` 或标准路径重新 checkout
到 `~/repos/<host>/<owner-or-group>/<repo>`。

清理 `~/repos/play` 前，先做只读巡检，避免误删仍有本地状态的 Git 仓库：

```bash
wst p status --max-depth 8
```

## 旧布局迁移

旧机器上可能已经存在 `~/repos/gh/<owner>/<repo>`、早期放在
`~/repos/play/<repo>` 的正式仓库，或其他按个人习惯组织的目录。迁移时把这些目录
当成历史别名，新 checkout 统一落到接近远程 URL 的路径：

```text
~/repos/<host>/<owner-or-group>/<repo>
```

迁移前先做只读巡检。目录嵌套较深时提高扫描深度：

```bash
wst p status --max-depth 8
```

也可以直接预览从旧路径到标准路径的迁移计划。该命令根据仓库 `origin`
remote 推导目标路径，默认只预览，不移动文件：

```bash
wst p migrate-layout --max-depth 8
```

如果仓库有未提交文件、未 push commit、stash、无 upstream 或 upstream 已消失，
先留在旧目录处理，不要批量移动。对于没有本地状态的常用 GitHub 仓库，优先用
`ghq` 在标准路径重新 checkout：

```bash
ghq get git@github.com:YunYouJun/workstation.git
```

如果需要保留本地分支、worktree 配置或其他只存在于旧目录的状态，可以在确认目标
路径不存在后单独移动一个仓库：

```bash
old=~/repos/gh/<owner>/<repo>
new=~/repos/github.com/<owner>/<repo>
git -C "$old" status --short --branch
mkdir -p "$(dirname "$new")"
mv "$old" "$new"
```

移动后用 `ghq list` 和 `wst p status --max-depth 8` 复查。私有或机器特定的迁移
清单只放在 `projects.local.yaml` 或私有配置仓库，不提交到公开仓库。

确认迁移计划后，才显式应用：

```bash
wst p migrate-layout --max-depth 8 --yes
```

## 跳转到项目

项目 checkout 的可复现路径由 `ghq` 管理，日常跳转交给 `zoxide`。

精确进入某个仓库：

```bash
cd "$(ghq list -p github.com/YunYouJun/workstation)"
```

第一次进入后，`zoxide` 会学习这个目录，之后可以用关键词跳转：

```bash
z workstation
z YunYouJun workstation
```

当关键词对应多个目录时，用 `zi` 交互选择：

```bash
zi workstation
```

需要从所有 checkout 中挑一个时，直接组合 `ghq` 和 `fzf`：

```bash
project="$(ghq list -p | fzf)" && cd "$project"
```

这套分工让项目路径保持可审计，也避免把私有简称、机器路径或临时 alias 写进公共仓库。

## 活跃 GitHub 仓库

使用 CLI 拉取并 clone `YunYouJun` 最近 push 过的仓库：

```bash
workstation projects clone-active
```

该命令默认是 dry-run。确认目标路径后，显式加 `--yes` 才会写入本机：

```bash
workstation projects clone-active --yes
```

配置最近活跃仓库数量：

```bash
workstation projects clone-active --limit 20
```

更短的写法：

```bash
wst p active --limit 20
```

交互式选择要预览或 clone 的仓库：

```bash
wst p active --limit 50 -i
```

也可以设置脚本默认值，适合写到 shell profile 或机器私有配置里：

```bash
WORKSTATION_ACTIVE_PROJECT_LIMIT=20 pnpm projects:clone-active
```

配置项目根目录：

```bash
workstation projects clone-active --root ~/repos
```

更新已存在的 checkout：

```bash
workstation projects clone-active --update --yes
```

使用 HTTPS clone URL：

```bash
workstation projects clone-active --https --yes
```

包含 forks 和 archived 仓库：

```bash
workstation projects clone-active --include-forks --include-archived
```

如果想用脚本入口：

```bash
pnpm projects:clone-active
```

实现上使用 `gh api graphql`，按 `PUSHED_AT DESC` 排序，比按字母或创建时间更接近“最近活跃”。先在本机完成 GitHub CLI 认证：

```bash
gh auth login
```

当已安装 `ghq`，且主 `ghq.root` 与 `--root` 一致时，命令会使用 `ghq get`。否则回退到显式 `git clone` 路径：

```text
~/repos/github.com/<owner>/<repo>
```

## 本地状态巡检

换机或清理旧机器前，检查 `~/repos` 下本地 Git 仓库是否还有需要处理的内容：

```bash
workstation projects status
```

短命令和脚本入口：

```bash
wst p status
pnpm projects:status
```

默认只显示需要关注的仓库，包括未提交文件、已提交但未 push、stash、没有 upstream 或 upstream 已消失的分支。显示所有仓库：

```bash
workstation projects status --all
```

默认最多向下扫描 6 层目录。仓库目录嵌套更深时可以调大，想限制扫描范围时也可以调小：

```bash
workstation projects status --max-depth 8
```

用于脚本或离机检查时，如果发现需要关注的仓库就返回非零退出码：

```bash
workstation projects status --check
```

需要给脚本、AI 或其他工具消费时，输出 JSON：

```bash
workstation projects status --json
workstation projects status --all --json
```

默认状态检查不访问网络，只读取本地 Git 状态。需要在检查前刷新远端
tracking refs 时，显式加 `--fetch`。该选项不会改工作区文件，但会更新 `.git`
中的远端引用；离线或认证失败会作为对应仓库的 fetch error 汇总：

```bash
workstation projects status --fetch
workstation projects status --fetch --json
```

## 清单模式

清单模式可以 clone 任意 Git 源的常用项目，包括 GitHub、GitHub Enterprise、GitLab、`git.example.com` 等内部源。命令同样默认 dry-run，确认后再加 `--yes`：

不想记 manifest 路径或 group 名称时，使用交互式向导。它会让你选择本地清单、私有配置仓库、group 和仓库，并打印可复用命令：

```bash
wst p manifest -i
wst p connect -i
wst p m -i
```

向导会在选择前显示精简的本地计划。每个仓库会标记为 `new`、`exists`、`exists clean, will update` 或 `needs attention`。本次会跳过或需要处理的仓库默认不会被选中，方便先聚焦可执行的 clone 和干净更新。

```bash
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --validate
wst p manifest --file projects.local.yaml --yes
```

也可以把常用项目清单放在私有配置仓库里，让 workstation 先读取配置仓库中的 `projects.yaml`：

```bash
wst p manifest https://git.example.com/<user>/<config-repo>
wst p manifest https://git.example.com/<user>/<config-repo> --group common --yes
wst p m https://git.example.com/<user>/<config-repo> -g common --yes
```

也可以直接传远程 YAML 文件链接。`raw` 链接会直接下载；`blob` 页面链接会自动转换为对应的 `raw` 链接：

```bash
wst p manifest https://git.example.com/<user>/<config-repo>/raw/main/projects.yaml -g common
wst p manifest https://git.example.com/<user>/<config-repo>/blob/main/projects.yaml -g common
```

私有 raw/blob 链接需要能被 `curl` 直接访问；如果浏览器已登录但命令行拿到的是登录页 HTML，请改用 `--repo <git-url> --manifest <path>`。

只处理 group 里的部分仓库时，使用 `--repository` 指定目标仓库名。交互式向导在你选择仓库子集后，也会打印这种可复制命令：

```bash
wst p m --file projects.local.yaml -g common --repository git.example.com/example/service
```

如果清单不在仓库根目录的 `projects.yaml` 或 `projects.yml`，指定内部路径：

```bash
wst p manifest --repo https://git.example.com/<user>/<config-repo> --manifest workstation/projects.yaml
```

私有配置仓库和远程 manifest 文件都会缓存到 `~/.cache/workstation/project-manifests/`。项目本身仍会 clone 到 `~/repos/<host>/<repo-path>` 这种接近 `ghq` 的路径；`group` 只用于筛选和组织清单，不进入目标路径。当主 `ghq.root` 与目标 root 一致，且目标路径与 clone URL 推导出的路径一致时使用 `ghq get`，否则回退到显式 `git clone`。

非交互 `--update --yes` 使用同一套本地安全检查。脏工作区、未 push、stash、缺失 upstream、已消失 upstream，以及已存在但不是 Git 仓库的路径都会被跳过并说明原因，不会盲目更新。

公开仓库只提交一个示例清单：

```text
projects.example.yaml
```

私有或机器特定项目放在：

```text
projects.local.yaml
```

`projects.local.yaml` 会被 Git 忽略。

清单格式：

```yaml
groups:
  common:
    root: ~/repos
    host: git.example.com
    repositories:
      - name: github.com/YunYouJun/workstation
        url: git@github.com:YunYouJun/workstation.git
      - example/private-service
      - name: local-alias/private-service
        path: example/private-service
```

如果只写 `name: git.example.com/<group>/<repo>`，CLI 会默认推断 SSH clone URL；加 `--https` 时会推断 HTTPS clone URL。也可以在 manifest 或 group 上配置 `host`，随后用 `example/private-service` 这类短路径。需要同时支持两种协议时，也可以写 `sshUrl` 与 `httpsUrl`，命令会按 `--https` 选择。

当本地目标路径需要和远端路径不同，使用对象格式的 `name` + `path`：`name` 是本地路径，`path` 是远端仓库路径。这种情况会自动避开 `ghq get`，用显式 `git clone <url> <target>`，避免 ghq 按远端 URL 放到另一个目录。

`--validate` 只校验清单并退出，不输出 clone 预览。CLI 会检查清单结构、字段类型、指定 group 是否存在、短路径是否配置了 `host`、clone URL/目标路径能否推断，以及多个条目是否会 clone 到同一个目标目录。普通 dry-run 和 `--yes` 写入前也会走同一套校验。

## SSH 基线

SSH key、`~/.ssh/config` 和远程机器地址都属于本机配置，不放进公开仓库。仓库只记录可复用模式。

生成新的 GitHub SSH key：

```bash
ssh-keygen -t ed25519 -C "you@example.com"
cat ~/.ssh/id_ed25519.pub
```

把公钥安装到远程机器：

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@example-host
```

给远程开发机器写明确的 host 条目，方便 VS Code Remote SSH、终端和脚本复用同一个入口：

```text
Host devbox
  HostName example-host
  User user
  PreferredAuthentications publickey
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

如果网络只允许 443 出口，再为 GitHub SSH 添加 443 端口 fallback；不要为了访问 GitHub 长期维护过期的 hosts IP 列表：

```text
Host github.com
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
```

验证 GitHub SSH：

```bash
ssh -T git@github.com
```

macOS 如果需要让本机接受 SSH 连接，先在「系统设置 -> 共享」里打开「远程登录」。不要把真实内网主机名、用户名或端口写入公开仓库。

临时 SSH 本地端口转发：

```bash
ssh -L <local-port>:<remote-host>:<remote-port> <ssh-hostname>
```

常见示例是把远程数据库端口只转发到本机：

```bash
ssh -L 3306:localhost:3306 user@example-host
```

需要后台保持隧道时再加 `-fN`；只有明确需要允许其他机器连入本机转发端口时才使用 `-g`。

## Git 多账号与来源隔离

同一台机器访问 GitHub、GitHub Enterprise、公司 GitLab 或其他内部 Git 源时，把“提交身份”和“远端认证账号”分开配置：

- 提交身份用 Git 的 `includeIf` 按 checkout 目录选择。
- 认证账号用 SSH `Host` / `IdentityFile` 或 HTTPS credential helper 选择。
- 全局开启 `user.useConfigOnly`，避免 Git 自动猜测错误邮箱。
- 同一个 host 上有多个账号时，使用 SSH Host alias，并把仓库 remote 指向 alias。

全局 Git 配置只负责路由，不直接写默认身份：

```ini
[user]
  useConfigOnly = true

[includeIf "gitdir:~/repos/github.com/"]
  path = ~/.gitconfig-github

[includeIf "gitdir:~/repos/git.example.com/"]
  path = ~/.gitconfig-work
```

不同来源的身份放在独立文件里：

```ini
# ~/.gitconfig-github
[user]
  name = Your Name
  email = you@example.com
```

```ini
# ~/.gitconfig-work
[user]
  name = Your Name
  email = you@company.example
```

SSH 认证账号通过 host 配置决定：

```text
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes

Host git.example.com-work
  HostName git.example.com
  User git
  IdentityFile ~/.ssh/id_ed25519_work
  IdentitiesOnly yes
```

同一 host 多账号时，仓库 remote 使用 alias：

```bash
git remote set-url origin git@git.example.com-work:team/repo.git
```

检查当前仓库最终生效的身份与认证入口：

```bash
git config --show-origin --get user.name
git config --show-origin --get user.email
git remote -v
ssh -G git.example.com-work | grep identityfile
```

不建议默认依赖 `includeIf "hasconfig:remote.*.url:..."` 根据 remote URL 自动切换身份。新 clone、fork + upstream、多 remote 仓库都可能让规则变得含糊；按 `~/repos/<host>/...` 目录切换身份更容易预测和审计。

CLI 中对应的初始化任务是 `git.include-if`。先查看任务和预览写入内容：

```bash
wst init --list
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com'
```

确认后再应用：

```bash
wst init git.include-if --git-profile 'id=github;host=github.com;name=Your Name;email=you@example.com' --yes
```

如果本机已经有 `~/.gitconfig-github` 且其中包含 `user.name` / `user.email`，也可以直接让 CLI 推断默认 GitHub profile：

```bash
wst init git.include-if --yes
```

需要手动选择初始化任务和输入身份信息时，使用交互模式：

```bash
wst init -i
```

## 最佳实践

- 普通项目 checkout 优先使用 `ghq`。
- 偏好线性历史且仓库未明确采用 merge 工作流时，推荐设置 `git config --global pull.rebase true`，避免 `git pull` 产生仅用于同步的 merge commit。
- Git 提交身份按 `~/repos/<host>/...` 目录切换，远端认证账号按 SSH host 或 credential helper 切换。
- 开启 `user.useConfigOnly`，让未匹配身份的仓库无法提交。
- 按用途分组项目，而不是按历史偶然性分组；分组不应改变 clone 目标路径。
- 公开示例保持通用。
- 对需要主动 push 的仓库优先使用 SSH URL。
- Clone 脚本默认使用 dry-run。
- 仓库已存在时跳过，除非显式请求更新模式。
- 目标目录应可配置，默认根目录为 `~/repos`。
- GitHub 特定的列表和认证流程使用 `gh`。
- “活跃仓库”发现使用 `PUSHED_AT` 排序。

`pull.rebase=true` 只会 rebase 本地尚未推送的提交，不会重写远端已有提交。发生冲突时，使用 `git rebase --continue` 继续，或使用 `git rebase --abort` 放弃本次 rebase。明确采用 merge 工作流的仓库可以局部覆盖：

```bash
git config pull.rebase false
```

如果不希望自动 rebase，而是希望分支出现分叉时直接停止，可以改用更保守的 fast-forward-only 策略：

```bash
git config --global pull.rebase false
git config --global pull.ff only
```

清单模式可以继续扩展更多分组，同时不需要把私有仓库名放进公开 Git。对于普通 Git 仓库，它会生成与 `ghq` 一致的目标路径。

## 迁移旧路径

如果此仓库已经存在于旧的简称路径，可以移动一次，并只在旧编辑器窗口或脚本还引用旧路径时保留兼容 symlink：

```bash
mkdir -p ~/repos/github.com/YunYouJun
mv ~/repos/gh/yyj/workstation ~/repos/github.com/YunYouJun/workstation

mkdir -p ~/repos/gh/yyj
ln -s ~/repos/github.com/YunYouJun/workstation ~/repos/gh/yyj/workstation
```

当 shell 历史、编辑器工作区和本地脚本都使用新路径后，就可以移除兼容 symlink。
