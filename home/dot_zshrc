# More info see https://www.yuque.com/yunyoujun/notes/oh-my-zsh
# oh-my-zsh template: https://github.com/ohmyzsh/ohmyzsh/blob/master/templates/zshrc.zsh-template
# --------

# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Homebrew initialization (Apple Silicon)
eval "$(/opt/homebrew/bin/brew shellenv)"

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Theme
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
# https://github.com/romkatv/powerlevel10k
# If you not use iterm2/termux, you need install font. https://github.com/romkatv/powerlevel10k#manual-font-installation
# ZSH_THEME="powerlevel10k/powerlevel10k"

# install zsh plugins
# git clone https://github.com/lukechilds/zsh-nvm ~/.oh-my-zsh/custom/plugins/zsh-nvm
# git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
# git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# autojump https://github.com/wting/autojump
# macos: brew install autojump

plugins=(
	autojump
	git
  node
  dotenv
  macos
  zsh-autosuggestions
  zsh-syntax-highlighting
  docker
  docker-compose
)

source $ZSH/oh-my-zsh.sh

# ---- User configuration ----

export VISUAL=buddycn

# fnm (fast node manager)
eval "$(fnm env --use-on-cd)"

# powerlevel10k theme (installed via homebrew)
source /opt/homebrew/share/powerlevel10k/powerlevel10k.zsh-theme
# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# pnpm
export PNPM_HOME="$HOME/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

# bun
[ -s "/Users/yunyou/.bun/_bun" ] && source "/Users/yunyou/.bun/_bun"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# ruby
export PATH="/opt/homebrew/Cellar/ruby/3.3.5/bin:$PATH"

# android
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools"
export JAVA_HOME="/opt/homebrew/opt/openjdk@21"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk)"

# envman
[ -s "$HOME/.config/envman/load.sh" ] && source "$HOME/.config/envman/load.sh"

# Additional PATH
export PATH="$HOME/.codebuddy/bin:$PATH"        # CodeBuddy CN
export PATH="$HOME/.local/bin:$PATH"             # CloudBase CLI
export PATH="$HOME/background_agent_cli/bin:$PATH" # background_agent_cli

# simple-git-hooks: ensure pnpm is in PATH for GUI git clients
export SIMPLE_GIT_HOOKS_RC="$HOME/.simple-git-hooks-rc"

# ---- Aliases ----

# dev shortcuts (using ni toolchain)
alias build="nr build"
alias dev="nr dev"
alias lint="nr lint"
alias lintf="pnpm run lint --fix" # npm can not pass --fix
alias mock="nr mock"
alias serve="nr serve"
alias tc="nr typecheck"

# git
alias gcgithub="git config user.name 'YunYouJun' && git config user.email 'me@yunyoujun.cn'"
# git fetch & 工蜂
unalias gf

# tencent npm mirror
alias tnpm="pnpm i --registry=http://mirrors.tencent.com/npm/"

# for terminal proxy
# WSL use windows dns ip, see it by `cat /etc/resolv.conf`
# local use 127.0.0.1
# macos surge do not need it
alias goproxy="export https_proxy=http://127.0.0.1:8234;export http_proxy=http://127.0.0.1:8234;export all_proxy=socks5://127.0.0.1:8235"
alias disproxy="unset https_proxy;unset http_proxy;unset all_proxy"

# python
alias python2="$HOME/.pyenv/versions/2.7.18/bin/python2"

# ---- Secrets (managed by dotfiles sync) ----

export OA_PAGES_API_KEY="{{DOTFILES_SECRET:OA_PAGES_API_KEY}}"
