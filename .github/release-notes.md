## Downloads / 下载

Pick the file for your device. Not sure? Use the **bold** one.
请选择适合你设备的文件。不确定的话，选 **加粗** 的那个。

| Platform / 平台 | Files / 文件 |
|---|---|
| **Windows 10/11** (64-bit) | **`CloudVault-{{VERSION}}-windows-x64-setup.exe`** · `…-x64.msi` (IT / Group Policy) · `…-x64-portable.exe` (no install / 免安装) |
| Windows 32-bit | `CloudVault-{{VERSION}}-windows-x86-setup.exe` · `…-x86.msi` · `…-x86-portable.exe` |
| Windows on ARM (Surface Pro X, Snapdragon) | `CloudVault-{{VERSION}}-windows-arm64-setup.exe` · `…-arm64-portable.exe` |
| Windows 7/8 or no WebView2 | `CloudVault-{{VERSION}}-windows-lite.exe` (opens in Edge / your browser) |
| **macOS** (any Mac) | **`CloudVault-{{VERSION}}-macos-universal.dmg`** · smaller: `…-macos-arm64.dmg` (Apple Silicon) / `…-macos-x64.dmg` (Intel) · `.app.zip` versions |
| **Linux** x64 | **`CloudVault-{{VERSION}}-linux-x64.AppImage`** (any distro) · `.deb` (Debian/Ubuntu/Mint) · `.rpm` (Fedora/openSUSE/RHEL) |
| Linux ARM64 (Raspberry Pi 4/5, ARM laptops) | `CloudVault-{{VERSION}}-linux-arm64.AppImage` · `.deb` · `.rpm` |
| **SteamOS / Steam Deck** (also Bazzite, ChimeraOS; Legion Go, ROG Ally) | One command, see **Quick install** below. Or download `CloudVault-{{VERSION}}-linux-x64.AppImage` and run `bash cloudvault-steamos-install.sh ~/Downloads/CloudVault-{{VERSION}}-linux-x64.AppImage` |
| **Android** 7+ | **`CloudVault-{{VERSION}}-android-universal.apk`** · smaller per-CPU: `…-arm64-v8a.apk` (most phones) / `…-armeabi-v7a.apk` (older phones) / `…-x86_64.apk` / `…-x86.apk` (emulators, Chromebooks) |
| iOS / iPadOS | Open your sync server in Safari → Share → *Add to Home Screen* |
| Any browser (PWA) | `CloudVault-{{VERSION}}-web.zip` — host the static files anywhere |
| **Sync server** | `docker run -d -p 8787:8787 -v cloudvault:/data ghcr.io/{{REPO}}:{{VERSION}}` (amd64 / arm64 / armv7) · or `CloudVault-{{VERSION}}-server.tar.gz` / `.zip` → `node server/server.js` (Node ≥ 20) |

Verify downloads with `SHA256SUMS.txt` (`sha256sum -c SHA256SUMS.txt --ignore-missing`).
可以用 `SHA256SUMS.txt` 校验下载的文件。

### Quick install: SteamOS / Steam Deck / Bazzite / ChimeraOS (any Linux) · 一键安装

In Desktop Mode, open **Konsole** and run:
在桌面模式下打开 **Konsole** 并运行：

```bash
curl -fsSL https://github.com/{{REPO}}/releases/latest/download/cloudvault-steamos-install.sh | bash
```

It downloads the latest AppImage for your CPU (x64 or ARM64) and checks it against `SHA256SUMS.txt`. Then it installs to `~/Applications`, adds a menu entry and adds CloudVault to Steam for Gaming Mode. Run the same command again to update.
Uninstall: `curl -fsSL https://github.com/{{REPO}}/releases/latest/download/cloudvault-steamos-install.sh | bash -s -- --uninstall`

它会下载适合你 CPU（x64 或 ARM64）的最新 AppImage，并用 `SHA256SUMS.txt` 校验。然后安装到 `~/Applications`，添加菜单项，并把 CloudVault 添加到 Steam 以便在游戏模式中使用。再次运行同一命令即可更新。
