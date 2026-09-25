## Downloads / 下载

Pick the file for your device. Not sure? Use the **bold** one.
请选择适合你设备的文件。不确定的话，选 **加粗** 的那个。

| Platform / 平台 | Files / 文件 |
|---|---|
| **Windows 10/11** (64-bit) | **`CloudVault-windows-x64-setup.exe`** · `…-x64.msi` (IT / Group Policy) · `…-x64-portable.zip` (no install, keeps data beside the .exe / 免安装便携版) |
| Windows 32-bit | `CloudVault-windows-x86-setup.exe` · `…-x86.msi` · `…-x86-portable.zip` |
| Windows on ARM (Surface Pro X, Snapdragon) | `CloudVault-windows-arm64-setup.exe` · `…-arm64-portable.zip` |
| Windows 7/8 or no WebView2 | `CloudVault-windows-lite.exe` (opens in Edge / your browser) |
| **macOS** (any Mac) | **`CloudVault-macos-universal.dmg`** · smaller: `…-macos-arm64.dmg` (Apple Silicon) / `…-macos-x64.dmg` (Intel) · `.app.zip` versions |
| **Linux** x64 | **`CloudVault-linux-x64.AppImage`** (any distro, no install; add a `CloudVault-linux-x64.AppImage.home` folder beside it to keep data portable) · `.deb` (Debian/Ubuntu/Mint) · `.rpm` (Fedora/openSUSE/RHEL) |
| Linux ARM64 (Raspberry Pi 4/5, ARM laptops) | `CloudVault-linux-arm64.AppImage` · `.deb` · `.rpm` |
| **SteamOS / Steam Deck** | `CloudVault-linux-x64.AppImage` → Properties → *Is executable* → *Add a Non-Steam Game* |
| **Android** 7+ | **`CloudVault-android-universal.apk`** · smaller per-CPU: `…-arm64-v8a.apk` (most phones) / `…-armeabi-v7a.apk` (older phones) / `…-x86_64.apk` / `…-x86.apk` (emulators, Chromebooks) |
| iOS / iPadOS | Open your sync server in Safari → Share → *Add to Home Screen* |
| Any browser (PWA) | `CloudVault-web.zip` — host the static files anywhere |
| **Sync server** | `docker run -d -p 8787:8787 -v cloudvault:/data ghcr.io/{{REPO}}:{{VERSION}}` (amd64 / arm64 / armv7) · or `CloudVault-server.tar.gz` / `.zip` → `node server/server.js` (Node ≥ 20) |

Verify downloads with `SHA256SUMS.txt` (`sha256sum -c SHA256SUMS.txt --ignore-missing`).
可以用 `SHA256SUMS.txt` 校验下载的文件。
