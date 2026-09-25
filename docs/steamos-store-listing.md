# Listing CloudVault on a SteamOS store

SteamOS has two places where users find add-ons and apps:

| Store | Where users see it | What gets listed |
|---|---|---|
| **Decky Loader plugin store** | Gaming Mode → `…` Quick Access menu → 🔌 Decky → 🛒 | A *Decky plugin* (a React panel + optional Python backend), not a desktop app |
| **Flathub** | Desktop Mode → **Discover** | A Flatpak of the desktop app |

Both stores need the **maintainer** to do the submission. Each has rules about AI-written code. Read them before you start:

- **Decky:** the plugin-addition PR checklist asks you to confirm that *"Generative AI was NOT used to write a majority of the code I am submitting"*. See the [template](https://github.com/SteamDeckHomebrew/decky-plugin-database/blob/main/.github/PULL_REQUEST_TEMPLATE/plugin_addition.md).
- **Flathub:** you must disclose AI-generated code in the app. The manifest itself must contain no AI-generated or AI-assisted content, and AI tools must not open, write or reply on the submission PR. See the [requirements](https://docs.flathub.org/docs/for-app-authors/requirements).

Parts of CloudVault were written with an AI assistant, so disclose that where a store asks. Write the store-specific parts yourself: the Decky plugin code, the Flatpak manifest and the PR text.

---

## Option A: Decky Loader plugin store

A plugin would suit CloudVault well: a Quick Access panel to unlock, search and copy a password without leaving the game. It can reuse `app/js/crypto.js`, `fuzzy.js` and `store.js`, because they use WebCrypto and `fetch`, which the Steam client's browser provides.

1. **Create a separate repo** (for example `cloudvault-decky`) from the official template: <https://github.com/SteamDeckHomebrew/decky-plugin-template>. The store adds plugins as git submodules and builds from the repo root, so the plugin can't live in a sub-folder of this repo.
2. **Write the plugin yourself** with `@decky/ui` components (`PanelSection`, `TextField`, `ButtonItem`). Keep the master password and decrypted vault in memory only, and lock when the QAM closes or after the auto-lock timeout.
3. **`plugin.json`:** your name as `author`, no `_root` flag (CloudVault needs no root), `publish.tags` such as `["security", "utility"]`, and a screenshot URL in `publish.image`.
4. **`package.json`:** set `version` and `license`. Bump the version on every update.
5. **Test on the SteamOS Stable and Beta channels** on a real Deck (Settings → System → System Update Channel).
6. **Fork** <https://github.com/SteamDeckHomebrew/decky-plugin-database>, then add your repo as a submodule:
   ```bash
   git submodule add https://github.com/<you>/cloudvault-decky plugins/CloudVault
   ```
7. **Open the PR yourself** with the *Plugin addition* template. Fill in every checkbox honestly. Optionally, test two other open plugin PRs and link your reports, which speeds up review.

## Option B: Flathub (Discover)

1. Read <https://docs.flathub.org/docs/for-app-authors/submission>. Flathub builds from source with no network access, so a Tauri app needs its Cargo and npm dependencies vendored with [flatpak-builder-tools](https://github.com/flatpak/flatpak-builder-tools) (`flatpak-cargo-generator.py`).
2. Add AppStream metainfo (`io.github.cloudvault.metainfo.xml`) with screenshots, and a `.desktop` file. Validate with `flatpak run --command=flatpak-builder-lint org.flatpak.Builder appstream …`.
3. Pick an app ID you control. `io.github.<your-github-user>.CloudVault` needs the repo under that GitHub account.
4. Write the manifest yourself and test it locally with `flatpak-builder`, including on a Steam Deck in Desktop and Gaming Mode.
5. Open the submission PR against `flathub/flathub` (branch `new-pr`) yourself, with the AI disclosure.

## Available today, with no store review

Every GitHub Release includes the AppImages, `SHA256SUMS.txt` and `cloudvault-steamos-install.sh`. In Desktop Mode, users open Konsole and run:

```bash
curl -fsSL https://github.com/liudeha51-droid/cloud/releases/latest/download/cloudvault-steamos-install.sh | bash
```

The script downloads the latest AppImage for the CPU (x64 or ARM64) and verifies its SHA-256. It then installs to `~/Applications`, adds a menu entry and adds CloudVault to Steam for Gaming Mode. Running it again updates. It works on SteamOS, Bazzite and ChimeraOS.
