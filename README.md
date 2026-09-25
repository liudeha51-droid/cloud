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
| `.github/workflows/` | CI tests, desktop releases, Android APK, iOS build |

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
| **Windows** | `.msi` / `.exe` from GitHub Releases |
| **Linux** | `.AppImage`, `.deb` or `.rpm` from Releases |
| **SteamOS / Steam Deck** | Desktop Mode → download the `.AppImage` → right-click → Properties → *Is executable* → in Steam: *Add a Non-Steam Game* to launch it from Gaming Mode. Touchscreen + on-screen keyboard (Steam + X) work. |
| **Android** | `.apk` from Releases (sideload), or open your server URL in Chrome → *Install app* |
| **iOS / iPadOS** | Open your server URL in Safari → Share → *Add to Home Screen* (PWA, no Apple account needed), or build the native app (below) |
| **Any browser** | Open your server URL |

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
- **Releases:** create and push a version tag (`git tag v0.1.0`, then `git push --tags`). *Release desktop* builds Windows/Linux/macOS installers into a draft release, and *Android APK* attaches an APK. Review the draft and publish it.
- **Signed Android release (optional):** add repo secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. Without them you get a debug-signed APK, which is fine for sideloading.
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
