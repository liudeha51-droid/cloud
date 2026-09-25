#!/usr/bin/env bash
# CloudVault installer for SteamOS and SteamOS-like distros (Bazzite, ChimeraOS, HoloISO, …).
# CloudVault 安装脚本，适用于 SteamOS 及类 SteamOS 发行版（Bazzite、ChimeraOS、HoloISO 等）。
#
# The root filesystem on these systems is read-only / image-based, so everything goes in your home folder:
#   ~/Applications/CloudVault.AppImage, a menu entry, and (where available) a Steam shortcut for Gaming Mode.
# 这些系统的根文件系统是只读/镜像式的，所以所有文件都放在你的主目录中：
#   ~/Applications/CloudVault.AppImage、应用菜单项，以及（如可用）用于游戏模式的 Steam 快捷方式。
#
# Usage (Desktop Mode → Konsole) / 用法（桌面模式 → Konsole）:
#   bash install.sh                      # download + install the latest release / 下载并安装最新版本
#   bash install.sh --update             # same, to update / 同上，用于更新
#   bash install.sh ~/Downloads/CloudVault-*-linux-x64.AppImage   # a file you already downloaded / 已下载的文件
#   bash install.sh --uninstall
set -euo pipefail

APP_DIR="$HOME/Applications"
TARGET="$APP_DIR/CloudVault.AppImage"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP="$DATA/applications/cloudvault.desktop"
ICON="$DATA/icons/hicolor/256x256/apps/cloudvault.png"
# Filled in by the release workflow (owner/repo). / 由发布流程填入（owner/repo）。
DEFAULT_REPO='{{REPO}}'
DL=""; TMP=""
trap 'rm -rf "$DL" "$TMP"' EXIT

say() { printf '\033[1m%s\033[0m\n' "$*"; }

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$TARGET" "$DESKTOP" "$ICON"
  say "Removed CloudVault. Your vault data (~/.local/share/io.github.cloudvault) was kept."
  say "已移除 CloudVault。你的密码库数据（~/.local/share/io.github.cloudvault）已保留。"
  say "Remove the Steam shortcut yourself: Library → CloudVault → ⚙ → Manage → Remove non-Steam game."
  exit 0
fi

case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  *) ARCH=x64 ;;
esac

# Download the AppImage from GitHub Releases and check it against SHA256SUMS.txt.
# The release workflow fills in DEFAULT_REPO; override with CLOUDVAULT_REPO=owner/repo, pin with CLOUDVAULT_VERSION=0.2.0.
# 从 GitHub Releases 下载 AppImage，并用 SHA256SUMS.txt 校验。
# 发布流程会填入 DEFAULT_REPO；可用 CLOUDVAULT_REPO=owner/repo 覆盖，用 CLOUDVAULT_VERSION=0.2.0 指定版本。
download() {
  local repo="${CLOUDVAULT_REPO:-$DEFAULT_REPO}" ver="${CLOUDVAULT_VERSION:-}" tag base name
  if [[ "$repo" == *"{{"* ]]; then
    echo "Set CLOUDVAULT_REPO=owner/repo (this copy of the script didn't come from a release)." >&2
    exit 1
  fi
  if [[ -z "$ver" ]]; then
    # /releases/latest redirects to /releases/tag/vX.Y.Z / /releases/latest 会重定向到 /releases/tag/vX.Y.Z
    tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")"
    tag="${tag##*/}"
    [[ "$tag" == v* ]] || { echo "No published release found for $repo. / 未找到 $repo 的已发布版本。" >&2; exit 1; }
    ver="${tag#v}"
  fi
  base="https://github.com/$repo/releases/download/v$ver"
  name="CloudVault-$ver-linux-$ARCH.AppImage"
  DL="$(mktemp -d)"
  say "Downloading $name … / 正在下载 $name …"
  curl -fL --progress-bar -o "$DL/$name" "$base/$name" \
    || { echo "Could not download $name from $repo (v$ver). / 无法下载 $name。" >&2; exit 1; }
  if curl -fsSL -o "$DL/SHA256SUMS.txt" "$base/SHA256SUMS.txt"; then
    # Lines look like "<hash>  name" (or "<hash> *name"). / 行格式为 "<hash>  name"（或 "<hash> *name"）。
    local want got
    want="$(awk -v n="$name" '$2 == n || $2 == "*" n { print $1; exit }' "$DL/SHA256SUMS.txt")"
    got="$(sha256sum "$DL/$name" | awk '{ print $1 }')"
    [[ -n "$want" && "$want" == "$got" ]] \
      || { echo "Checksum mismatch — not installing. / 校验失败，已停止安装。" >&2; exit 1; }
    say "Checksum OK. / 校验通过。"
  else
    say "SHA256SUMS.txt not found; skipping checksum. / 未找到 SHA256SUMS.txt，跳过校验。"
  fi
  SRC="$DL/$name"
}

SRC="${1:-}"
if [[ -z "$SRC" || "$SRC" == "--update" ]]; then
  download
elif [[ ! -f "$SRC" ]]; then
  echo "Usage: bash install.sh [path/to/CloudVault-<version>-linux-$ARCH.AppImage | --update]" >&2
  echo "With no file, the latest release is downloaded. / 不指定文件时会下载最新版本。" >&2
  exit 1
fi

# Identify the system (for the summary and distro-specific notes). / 识别系统（用于结果摘要和发行版说明）。
. /etc/os-release 2>/dev/null || true
OS="${PRETTY_NAME:-Linux}"
BOARD="$(cat /sys/class/dmi/id/board_name 2>/dev/null || true)"
case "$BOARD" in
  Jupiter) DEVICE="Steam Deck LCD" ;;
  Galileo) DEVICE="Steam Deck OLED" ;;
  *) DEVICE="$(cat /sys/class/dmi/id/product_version 2>/dev/null || true)" ;;
esac

mkdir -p "$APP_DIR" "$(dirname "$DESKTOP")" "$(dirname "$ICON")"
install -m 755 "$SRC" "$TARGET"

# Icon: pull the PNG out of the AppImage itself. / 图标：直接从 AppImage 中提取 PNG。
TMP="$(mktemp -d)"
if (cd "$TMP" && "$TARGET" --appimage-extract '*.png' >/dev/null 2>&1); then
  PNG="$(find "$TMP/squashfs-root" -maxdepth 1 -name '*.png' 2>/dev/null | head -n1 || true)"
  if [[ -n "$PNG" ]]; then install -m 644 "$PNG" "$ICON"; fi
fi

cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=CloudVault
Comment=Zero-knowledge password manager
Exec="$TARGET"
Icon=cloudvault
Categories=Utility;Security;
Terminal=false
DESK
command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP")" >/dev/null 2>&1 || true

say "Installed CloudVault → $TARGET"
say "System: $OS${DEVICE:+ · $DEVICE}"

# Gaming Mode: Valve's steamos-add-to-steam (SteamOS 3.5+, also shipped by Bazzite) adds a non-Steam game.
# 游戏模式：Valve 的 steamos-add-to-steam（SteamOS 3.5+，Bazzite 也自带）可以添加非 Steam 游戏。
if command -v steamos-add-to-steam >/dev/null; then
  steamos-add-to-steam "$TARGET" && say "Added to Steam → it's in Library → Non-Steam in Gaming Mode. / 已添加到 Steam。"
else
  say "Add it to Steam for Gaming Mode: Steam → Games → Add a Non-Steam Game → CloudVault."
  say "在 Steam 中添加以便在游戏模式使用：Steam → 游戏 → 添加非 Steam 游戏 → CloudVault。"
fi

cat <<'TIPS'

Gaming Mode tips / 游戏模式提示:
  • Controller layout: CloudVault → ⚙ → Controller Layout → "Gamepad" (or "Web Browser" – both work).
    控制器布局：选择“手柄”（或“网页浏览器”——两者都可以）。
  • A select · B back · X search + keyboard · Y copy password · LB/RB folders · View lock
  • Paste a copied password into another game/launcher: Steam + X → keyboard, or Ctrl+V.
    把复制的密码粘贴到其他游戏/启动器：Steam + X 打开键盘，或按 Ctrl+V。
TIPS
