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

## 清单模式

清单模式可以 clone 任意 Git 源的常用项目，包括 GitHub、GitHub Enterprise、GitLab、`git.example.com` 等内部源。命令同样默认 dry-run，确认后再加 `--yes`：

```bash
wst p manifest --file projects.local.yaml
wst p manifest --file projects.local.yaml --yes
```

也可以把常用项目清单放在私有配置仓库里，让 workstation 先读取配置仓库中的 `projects.yaml`：

```bash
wst p manifest https://git.example.com/<user>/<config-repo>
wst p manifest https://git.example.com/<user>/<config-repo> --group common --yes
```

如果清单不在仓库根目录的 `projects.yaml` 或 `projects.yml`，指定内部路径：

```bash
wst p manifest --repo https://git.example.com/<user>/<config-repo> --manifest workstation/projects.yaml
```

私有配置仓库会缓存到 `~/.cache/workstation/project-manifests/`。项目本身仍会 clone 到 `~/repos/<host>/<repo-path>` 这种接近 `ghq` 的路径；`group` 只用于筛选和组织清单，不进入目标路径。当主 `ghq.root` 与目标 root 一致，且目标路径与 clone URL 推导出的路径一致时使用 `ghq get`，否则回退到显式 `git clone`。

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

## 最佳实践

- 普通项目 checkout 优先使用 `ghq`。
- 按用途分组项目，而不是按历史偶然性分组；分组不应改变 clone 目标路径。
- 公开示例保持通用。
- 对需要主动 push 的仓库优先使用 SSH URL。
- Clone 脚本默认使用 dry-run。
- 仓库已存在时跳过，除非显式请求更新模式。
- 目标目录应可配置，默认根目录为 `~/repos`。
- GitHub 特定的列表和认证流程使用 `gh`。
- “活跃仓库”发现使用 `PUSHED_AT` 排序。

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
