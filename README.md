# CloudVault

A zero-knowledge **cloud password manager** that runs on **Android, iOS, Windows, Linux and SteamOS (Steam Deck)**,
with **typo-tolerant fuzzy search** and **one-click personal AI** (Claude or a fully local Ollama model).

- 🔐 **Zero-knowledge** — AES-256-GCM, keys derived on-device (PBKDF2-SHA256 × 600k → HKDF). The server stores only ciphertext.
- ☁️ **Self-hosted cloud sync** — one tiny Node server (no dependencies), offline-first, per-item conflict merging across devices.
- 🔎 **Fuzzy search** — `gmial` → Gmail, `amzn` → Amazon, `bank chase` → Chase Bank, accents & word order don't matter.
- ✨ **One-click personal AI** — Ask AI (plain-words search), 🛡 Security Audit, 🏷 Auto-organize, ✨ Suggest title/folder/tags.
  AI only ever sees titles, domains, tags and password *statistics* — **never passwords, usernames or notes** (enforced by `redact()` in [`app/js/ai.js`](app/js/ai.js), covered by tests).
- 📱 **One codebase everywhere** — plain HTML/JS app ([`app/`](app/)) packaged by [Tauri 2](https://tauri.app) for desktop & mobile, and installable as a PWA.
- 🎲 Secure generator, strength meter, clipboard auto-clear, auto-lock, CSV import (Chrome/Edge/Firefox/Bitwarden/1Password), encrypted backup.
- 🌐 **8 languages**: 简体中文, 繁體中文, English, 한국어, Español, Français, Deutsch, Русский. The app picks your system language automatically; switch it on the lock screen or in ⚙ Settings. AI answers come back in the same language.
  Translations live in [`app/js/i18n.js`](app/js/i18n.js), and `test/i18n.test.js` fails if any language is missing a string.
- 💬 Code comments are bilingual (English + 中文).

> **中文简介：** CloudVault 是一个零知识的云端密码管理器，支持 Android、iOS、Windows、Linux 和 SteamOS。它支持模糊搜索（允许错别字），并提供一键个人 AI（Claude 或本地 Ollama）。AI 永远看不到你的密码。界面支持 8 种语言，可在锁定界面或 ⚙ 设置中切换。

## Download

**Portable (no install):** unzip or run it from anywhere, including a USB stick.

| Platform | Portable download |
|---|---|
| Windows 10/11 (64-bit) | [CloudVault-windows-x64-portable.zip](https://github.com/liudeha51-droid/cloud/releases/latest/download/CloudVault-windows-x64-portable.zip) |
| Windows 32-bit | [CloudVault-windows-x86-portable.zip](https://github.com/liudeha51-droid/cloud/releases/latest/download/CloudVault-windows-x86-portable.zip) |
| Windows on ARM | [CloudVault-windows-arm64-portable.zip](https://github.com/liudeha51-droid/cloud/releases/latest/download/CloudVault-windows-arm64-portable.zip) |
| Windows 7/8 or no WebView2 | [CloudVault-windows-lite.exe](https://github.com/liudeha51-droid/cloud/releases/latest/download/CloudVault-windows-lite.exe) |
| macOS (any Mac) | [CloudVault-macos-universal.app.zip](https://github.com/liudeha51-droid/cloud/releases/latest/download/CloudVault-macos-universal.app.zip) |
| Linux x64 / SteamOS | [CloudVault-linux-x64.AppImage](https://github.com/liudeha51-droid/cloud/releases/latest/download/CloudVault-linux-x64.AppImage) |
| Linux ARM64 | [CloudVault-linux-arm64.AppImage](https://github.com/liudeha51-droid/cloud/releases/latest/download/CloudVault-linux-arm64.AppImage) |

- **Windows portable zip:** the included `portable.txt` makes CloudVault keep your encrypted vault in a `CloudVault-data` folder next to `CloudVault.exe`, so the whole folder moves with you. Delete `portable.txt` to store data in your user profile instead. The lite `.exe` does the same if you put a `portable.txt` beside it.
- **Linux AppImage:** create a folder named after the file plus `.home` (for example `CloudVault-linux-x64.AppImage.home`) next to it, and the AppImage keeps its data there.

Installers, Android APKs, the web bundle, the server and checksums are on the [latest release](https://github.com/liudeha51-droid/cloud/releases/latest).

> **下载：** 便携版无需安装，可放在 U 盘中使用。Windows 便携版压缩包中的 `portable.txt` 会让数据保存在 `CloudVault.exe` 旁边的 `CloudVault-data` 文件夹里。安装包和其他版本见[最新发布](https://github.com/liudeha51-droid/cloud/releases/latest)。

## Architecture

```
┌──────────── device (Android / iOS / Windows / Linux / SteamOS / browser) ────────────┐
│ master password ─PBKDF2─▶ master key ─HKDF─┬─▶ encKey  (never leaves device)          │
│                                            └─▶ authKey ──────────────┐                │
│ vault JSON ─AES-GCM(vaultKey)─▶ encrypted envelope ──────────────────┤                │
└──────────────────────────────────────────────────────────────────────┼────────────────┘
                                                                       ▼  HTTPS
                              ┌────── sync server (server/server.js) ──────┐
                              │ stores scrypt(authKey) + opaque envelope    │
                              │ optimistic versioning → 409 → client merges │
                              └─────────────────────────────────────────────┘
AI actions: redact(entries) ─▶ Claude API (your key)  or  Ollama on localhost (nothing leaves your network)
```

| Path | What |
|---|---|
| `app/` | The whole client: `index.html`, `styles.css`, `js/{crypto,fuzzy,store,ai,app}.js`, PWA manifest + service worker |
| `server/` | Zero-dependency sync server (also serves the PWA) + Dockerfile |
| `src-tauri/` | Native shell for Windows / Linux / macOS / Android / iOS |
| `test/` | `node --test` suites: crypto, fuzzy search, redaction, two-device sync & server hardening |
| `.github/workflows/` | CI tests, release builds (desktop, Android, web, Docker), iOS build |

## Quick start

### 1. Run the sync server (your "cloud")

```bash
docker compose up -d
```

or without Docker (Node ≥ 20):

```bash
node server/server.js
```

It listens on port `8787`. For use outside your LAN, put it behind HTTPS (Caddy, nginx, Cloudflare Tunnel, Tailscale Funnel…).
Once your account exists, set `ALLOW_REGISTRATION=false` in `docker-compose.yml`.

| Env var | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `CLOUDVAULT_DATA` | `server/data` | encrypted vaults + password hashes |
| `ALLOW_REGISTRATION` | `true` | set `false` after creating your account |
| `CORS_ORIGIN` | `*` | safe: auth is bearer tokens, no cookies |

### 2. Get the app

| Platform | How |
|---|---|
| **Windows 10/11** | `CloudVault-windows-x64-setup.exe` (or `.msi`, or the [portable zip](#download)) from GitHub Releases. Also 32-bit (`x86`) and ARM64 builds. |
| **Windows 7/8 / no WebView2** | `CloudVault-windows-lite.exe`: a tiny launcher that opens the app in Edge or your default browser |
| **macOS** | `CloudVault-macos-universal.dmg` (any Mac), or the smaller `arm64` (Apple Silicon) / `x64` (Intel) `.dmg` |
| **Linux** | `.AppImage` (any distro), `.deb` or `.rpm`, for x64 and ARM64 |
| **SteamOS / Steam Deck** | Desktop Mode → download the x64 `.AppImage` → right-click → Properties → *Is executable* → in Steam: *Add a Non-Steam Game* to launch it from Gaming Mode. Touchscreen + on-screen keyboard (Steam + X) work. |
| **Android 7+** | `CloudVault-android-universal.apk` from Releases (sideload), or a smaller per-CPU `.apk` (`arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86`), or open your server URL in Chrome → *Install app* |
| **iOS / iPadOS** | Open your server URL in Safari → Share → *Add to Home Screen* (PWA, no Apple account needed), or build the native app (below) |
| **Any browser** | Open your server URL, or host the static files from `CloudVault-web.zip` anywhere |

### 3. Create your vault

Enter a username and a strong master password, expand **Cloud sync server**, enter your server URL, and click **Create vault**.
On every other device, use the same username, password and server URL and click **Unlock**.
Leave the server empty for a device-only vault.

> ⚠️ Your master password **cannot be recovered**. Nobody (including the server) can decrypt your vault without it.

## Personal AI setup

Open ⚙ **Settings → Personal AI**. Settings (including your API key) are stored **inside your encrypted vault** and sync to your devices.

**Claude (default).** Paste an API key from [console.anthropic.com](https://console.anthropic.com). Default model: `claude-opus-5`.
Requests go straight from your device to `api.anthropic.com`. Your sync server never sees them.

**Ollama (100 % local/offline).** Install [Ollama](https://ollama.com), then run `ollama pull llama3.1`. Allow the app's origin:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

(On Windows, set `OLLAMA_ORIGINS` as a user environment variable and restart Ollama.)

| One-click action | What the AI receives |
|---|---|
| ✨ **Ask AI** (Shift+Enter in search) | your question + titles/domains/tags/folders |
| 🛡 **Audit** | titles/domains + password length, strength label, reuse count, age |
| 🏷 **Organize** | titles/domains/tags/folders → suggests folders & tags (you review before anything changes) |
| ✨ **Suggest** (in editor) | title + domain of that one item |

Settings → *Preview exactly what is sent* shows the redacted payload.
Password **generation** is always done locally with a CSPRNG and never by AI.

## Development

The client needs **no build step**: open `app/index.html` in a browser, or run the server and visit `http://localhost:8787`.

```bash
npm test
```

```bash
npm install
```

```bash
npm run icons
```

```bash
npm run dev
```

Tauri prerequisites (Rust, WebView2/WebKitGTK, Android Studio/NDK, Xcode): <https://tauri.app/start/prerequisites/>.

- Android: `npx tauri android init`, then `npm run android`
- iOS (macOS only): `npx tauri ios init`, then `npm run ios`

## Publishing on GitHub

```bash
git init -b main
```

```bash
git add . && git commit -m "CloudVault: initial commit"
```

```bash
gh repo create cloudvault --private --source . --push
```

Then:

- **CI** runs tests on every push.
- **Releases:** create and push a version tag (`git tag v0.1.0`, then `git push --tags`). The *Release* workflow builds every download into a draft release: Windows (x64/x86/ARM64 installers, `.msi`, portable `.zip`, lite `.exe`), macOS (universal/Apple Silicon/Intel), Linux (x64/ARM64 `.AppImage`/`.deb`/`.rpm`), Android (universal + per-ABI `.apk`), the web and server bundles, and `SHA256SUMS.txt`. It also pushes a multi-arch server image to `ghcr.io/<owner>/<repo>`. When every build succeeds, the workflow publishes the release itself; if one fails, the release stays a draft. No git access? Go to **Actions → Release → Run workflow** and type the version (e.g. `v0.2.0`): the workflow creates the tag and release for you. The notes come from `.github/release-notes.md`.
- **Signed Android release (optional):** add repo secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. With them you also get a signed `.aab` for Google Play. Without them you get debug-signed APKs, which are fine for sideloading.
- **iOS:** add `APPLE_DEVELOPMENT_TEAM`, `IOS_CERTIFICATE`, `IOS_CERTIFICATE_PASSWORD` and `IOS_MOBILE_PROVISION`, then run the *iOS* workflow manually. This requires a paid Apple Developer account. Otherwise, use the PWA.

## Security notes

- Crypto is standard WebCrypto only. No third-party JS runs in the app, and a strict CSP blocks inline and remote scripts.
- Server: scrypt-hashed auth keys, HMAC-signed 12 h tokens, login rate limiting, constant-time comparisons, atomic writes, path-traversal guard, 10 MB body cap.
- Deleted items become tombstones with their secrets wiped, so deletions sync.
- Mobile apps require **HTTPS** for a remote server (Android/iOS block cleartext HTTP).
- This is a young project that has not been independently audited. Keep an encrypted backup (Settings → Encrypted backup).

## Roadmap ideas

Master-password change (the vault key is already wrapped, so only a re-wrap is needed), TOTP codes, passkeys, browser autofill extension, Argon2id via WASM, shared vaults.

## License

MIT
