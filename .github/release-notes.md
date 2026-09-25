## Downloads / 下载

Click a file to download it. Not sure which one? Use the **bold** one. All files are also listed under **Assets** below.
点击文件名即可直接下载。不确定的话，选 **加粗** 的那个。所有文件也列在下方的 **Assets** 中。

| Platform / 平台 | Download / 下载 |
|---|---|
| **Windows 10/11** (64-bit) | **[Installer (.exe)]({{DL}}/CloudVault-{{VERSION}}-windows-x64-setup.exe)** · [.msi (IT / Group Policy)]({{DL}}/CloudVault-{{VERSION}}-windows-x64.msi) · [Portable .exe (no install / 免安装)]({{DL}}/CloudVault-{{VERSION}}-windows-x64-portable.exe) |
| Windows 32-bit | [Installer]({{DL}}/CloudVault-{{VERSION}}-windows-x86-setup.exe) · [.msi]({{DL}}/CloudVault-{{VERSION}}-windows-x86.msi) · [Portable]({{DL}}/CloudVault-{{VERSION}}-windows-x86-portable.exe) |
| Windows on ARM (Surface Pro X, Snapdragon) | [Installer]({{DL}}/CloudVault-{{VERSION}}-windows-arm64-setup.exe) · [Portable]({{DL}}/CloudVault-{{VERSION}}-windows-arm64-portable.exe) |
| Windows 7/8 or no WebView2 | [Lite .exe (opens in Edge / your browser)]({{DL}}/CloudVault-{{VERSION}}-windows-lite.exe) |
| **macOS** (any Mac) | **[Universal .dmg]({{DL}}/CloudVault-{{VERSION}}-macos-universal.dmg)** · smaller: [Apple Silicon .dmg]({{DL}}/CloudVault-{{VERSION}}-macos-arm64.dmg) / [Intel .dmg]({{DL}}/CloudVault-{{VERSION}}-macos-x64.dmg) · [universal .app.zip]({{DL}}/CloudVault-{{VERSION}}-macos-universal.app.zip) |
| **Linux** x64 | **[.AppImage (any distro)]({{DL}}/CloudVault-{{VERSION}}-linux-x64.AppImage)** · [.deb (Debian/Ubuntu/Mint)]({{DL}}/CloudVault-{{VERSION}}-linux-x64.deb) · [.rpm (Fedora/openSUSE/RHEL)]({{DL}}/CloudVault-{{VERSION}}-linux-x64.rpm) |
| Linux ARM64 (Raspberry Pi 4/5, ARM laptops) | [.AppImage]({{DL}}/CloudVault-{{VERSION}}-linux-arm64.AppImage) · [.deb]({{DL}}/CloudVault-{{VERSION}}-linux-arm64.deb) · [.rpm]({{DL}}/CloudVault-{{VERSION}}-linux-arm64.rpm) |
| **SteamOS / Steam Deck** (also Bazzite, ChimeraOS; Legion Go, ROG Ally) | One command, see **Quick install** below. Or download the [x64 .AppImage]({{DL}}/CloudVault-{{VERSION}}-linux-x64.AppImage) and the [installer script]({{DL}}/cloudvault-steamos-install.sh), then run `bash cloudvault-steamos-install.sh ~/Downloads/CloudVault-{{VERSION}}-linux-x64.AppImage` |
| **Android** 7+ | **[Universal .apk]({{DL}}/CloudVault-{{VERSION}}-android-universal.apk)** · smaller per-CPU: [arm64-v8a (most phones)]({{DL}}/CloudVault-{{VERSION}}-android-arm64-v8a.apk) / [armeabi-v7a (older phones)]({{DL}}/CloudVault-{{VERSION}}-android-armeabi-v7a.apk) / [x86_64]({{DL}}/CloudVault-{{VERSION}}-android-x86_64.apk) / [x86]({{DL}}/CloudVault-{{VERSION}}-android-x86.apk) (emulators, Chromebooks) |
| iOS / iPadOS | Open your sync server in Safari → Share → *Add to Home Screen* |
| Any browser (PWA) | [web.zip]({{DL}}/CloudVault-{{VERSION}}-web.zip): host the static files anywhere |
| **Sync server** | `docker run -d -p 8787:8787 -v cloudvault:/data ghcr.io/{{REPO}}:{{VERSION}}` (amd64 / arm64 / armv7) · or [server.tar.gz]({{DL}}/CloudVault-{{VERSION}}-server.tar.gz) / [server.zip]({{DL}}/CloudVault-{{VERSION}}-server.zip), then `node server/server.js` (Node ≥ 20) |

Verify downloads with [SHA256SUMS.txt]({{DL}}/SHA256SUMS.txt): `sha256sum -c SHA256SUMS.txt --ignore-missing`.
可以用 [SHA256SUMS.txt]({{DL}}/SHA256SUMS.txt) 校验下载的文件。

### Quick install: SteamOS / Steam Deck / Bazzite / ChimeraOS (any Linux) · 一键安装

In Desktop Mode, open **Konsole** and run:
在桌面模式下打开 **Konsole** 并运行：

```bash
curl -fsSL https://github.com/{{REPO}}/releases/latest/download/cloudvault-steamos-install.sh | bash
```

It downloads the latest AppImage for your CPU (x64 or ARM64) and checks it against `SHA256SUMS.txt`. Then it installs to `~/Applications`, adds a menu entry and adds CloudVault to Steam for Gaming Mode. Run the same command again to update.
Uninstall: `curl -fsSL https://github.com/{{REPO}}/releases/latest/download/cloudvault-steamos-install.sh | bash -s -- --uninstall`

它会下载适合你 CPU（x64 或 ARM64）的最新 AppImage，并用 `SHA256SUMS.txt` 校验。然后安装到 `~/Applications`，添加菜单项，并把 CloudVault 添加到 Steam 以便在游戏模式中使用。再次运行同一命令即可更新。
