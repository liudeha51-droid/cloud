// CloudVault platform profiles — per-device tuning for SteamOS and PC handhelds.
// CloudVault 平台配置 —— 针对 SteamOS 和 PC 掌机的按设备优化。
//
// The native shell (src-tauri/src/lib.rs → platform_info) reports the OS id and DMI model names;
// in a plain browser we fall back to user-agent / screen heuristics. The result is written to
// <html data-*> attributes that styles.css and gamepad.js key off:
//   data-steamos     SteamOS or a SteamOS-like distro (Bazzite, ChimeraOS, …)
//   data-gamemode    running inside Steam Gaming Mode (gamescope): dark theme, gamepad UI, fullscreen
//   data-handheld    small built-in screen → bigger touch targets and text
//   data-oled        OLED panel → true-black dark theme (saves battery, no grey glow)
//   data-device      deck-lcd | deck-oled | legion-go | legion-go-s | legion-go-2 | rog-ally | claw | handheld | pc
//
// 原生外壳（src-tauri/src/lib.rs → platform_info）会报告系统 id 和 DMI 型号名称；
// 在普通浏览器中则退回到 user-agent / 屏幕尺寸的推测。结果写入 <html data-*> 属性，
// 供 styles.css 和 gamepad.js 使用：
//   data-steamos     SteamOS 或类 SteamOS 发行版（Bazzite、ChimeraOS 等）
//   data-gamemode    运行在 Steam 游戏模式（gamescope）中：深色主题、手柄界面、全屏
//   data-handheld    小尺寸内置屏幕 → 更大的点击区域和字体
//   data-oled        OLED 屏幕 → 纯黑深色主题（省电，没有灰色泛光）
//   data-device      设备类型，见上
(function (root) {
  'use strict';

  // Known handhelds, matched against "vendor product board" from DMI. First match wins.
  // 已知掌机，与 DMI 中的“厂商 产品 主板”字符串匹配。先匹配者优先。
  const DEVICES = [
    { id: 'deck-lcd', label: 'Steam Deck LCD', test: /\bjupiter\b/i, oled: false },
    { id: 'deck-oled', label: 'Steam Deck OLED', test: /\bgalileo\b/i, oled: true },
    { id: 'legion-go-s', label: 'Legion Go S', test: /legion go s\b|\b83(l3|n6|q2|q3)\b/i, oled: false },
    { id: 'legion-go-2', label: 'Legion Go 2', test: /legion go 2\b/i, oled: true },
    { id: 'legion-go', label: 'Legion Go', test: /legion go\b|\b83e1\b/i, oled: false },
    { id: 'rog-ally', label: 'ROG Ally', test: /\bally\b|\brc7[123]/i, oled: false },
    { id: 'claw', label: 'MSI Claw', test: /\bclaw\b/i, oled: false },
    { id: 'handheld', label: 'Handheld', test: /ayaneo|onexplayer|one-netbook|gpd win|ayn\b|zotac zone/i, oled: false },
  ];

  // OS ids of SteamOS and distros that boot straight into Steam Gaming Mode.
  // SteamOS 及直接启动到 Steam 游戏模式的发行版的系统 id。
  const STEAM_OSES = {
    steamos: 'SteamOS', holo: 'SteamOS', bazzite: 'Bazzite', chimeraos: 'ChimeraOS',
    steamfork: 'SteamFork', holoiso: 'HoloISO', 'nobara-steam-handheld': 'Nobara Handheld',
  };

  // Pure: native/browser facts → profile. Unit-tested in test/platform.test.js.
  // 纯函数：原生/浏览器信息 → 配置。单元测试见 test/platform.test.js。
  function profileFor(info) {
    info = info || {};
    const hw = [info.vendor, info.product, info.productVersion, info.board].filter(Boolean).join(' ');
    const dev = DEVICES.find((d) => d.test.test(hw))
      || (info.steamDeck ? DEVICES[0] : null)
      || (info.guessHandheld ? { id: 'handheld', label: 'Handheld', oled: false } : null);
    const ids = [info.osId, info.osVariant].concat(String(info.osIdLike || '').split(/\s+/)).map((s) => String(s || '').toLowerCase());
    const osKey = ids.find((s) => STEAM_OSES[s]);
    const gameMode = !!info.gameMode;
    return {
      device: dev ? dev.id : 'pc',
      label: dev ? dev.label : '',
      os: osKey ? STEAM_OSES[osKey] : (info.osName || ''),
      osVersion: info.osVersion || '',
      steamos: !!osKey || (dev != null && /^deck/.test(dev.id)),
      gameMode,
      handheld: !!dev,
      oled: !!(dev && dev.oled),
      // Gamepad-first UI whenever there is no guaranteed mouse/keyboard.
      // 在不一定有鼠标/键盘时，使用手柄优先的界面。
      gamepad: gameMode || !!dev,
    };
  }

  // Browser-only guesses (PWA opened in Steam's browser, or no native shell).
  // 仅浏览器环境的推测（在 Steam 浏览器中打开的 PWA，或没有原生外壳时）。
  function browserInfo() {
    const nav = root.navigator || {};
    const ua = String(nav.userAgent || '');
    const scr = root.screen || {};
    const w = Math.max(scr.width || 0, scr.height || 0), hgt = Math.min(scr.width || 0, scr.height || 0);
    const linux = /Linux/.test(ua) && !/Android/.test(ua);
    return {
      gameMode: /Valve Steam (Tenfoot|GamepadUI)/.test(ua),
      steamDeck: linux && w === 1280 && hgt === 800 && (nav.maxTouchPoints || 0) > 0,
      guessHandheld: linux && (nav.maxTouchPoints || 0) > 0 && w <= 1920 && hgt <= 1200,
    };
  }

  function invoke(cmd) {
    const tauri = root.__TAURI__ && root.__TAURI__.core;
    const internals = root.__TAURI_INTERNALS__;
    if (tauri && tauri.invoke) return tauri.invoke(cmd);
    if (internals && internals.invoke) return internals.invoke(cmd);
    return null;
  }

  let current = profileFor({});
  const listeners = new Set();

  function apply(p) {
    current = p;
    const doc = root.document;
    if (!doc) return;
    const el = doc.documentElement;
    el.dataset.device = p.device;
    for (const k of ['steamos', 'gameMode', 'handheld', 'oled', 'gamepad']) {
      const attr = k === 'gameMode' ? 'gamemode' : k;
      if (p[k]) el.dataset[attr] = ''; else delete el.dataset[attr];
    }
    // Gaming Mode is always dark; keep the browser/WebView chrome in sync.
    // 游戏模式总是深色；让浏览器/WebView 的界面颜色保持一致。
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta && p.gameMode) meta.content = p.oled ? '#000000' : '#0f1115';
    for (const fn of listeners) fn(p);
  }

  function init() {
    apply(profileFor(browserInfo()));
    const pending = invoke('platform_info');
    if (pending && pending.then) {
      pending.then((native) => apply(profileFor(native))).catch(() => { /* old shell / 旧版外壳 */ });
    }
  }

  root.PV = root.PV || {};
  root.PV.platform = {
    DEVICES, profileFor, init,
    get profile() { return current; },
    onChange: (fn) => listeners.add(fn),
    // Steam's on-screen keyboard (Gaming Mode). No-op outside the native shell.
    // Steam 屏幕键盘（游戏模式）。不在原生外壳中时不执行任何操作。
    steamKeyboard() { const p = invoke('steam_keyboard'); if (p && p.catch) p.catch(() => {}); },
  };
  if (root.document) init();
})(typeof window !== 'undefined' ? window : globalThis);
