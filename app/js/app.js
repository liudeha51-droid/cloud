// CloudVault UI controller. All user data is rendered with textContent (never innerHTML).
// CloudVault 界面控制器。所有用户数据都用 textContent 渲染（绝不使用 innerHTML）。
(function () {
  'use strict';
  const { crypto: C, fuzzy, ai, store: S, i18n } = window.PV;
  const t = i18n.t;
  const store = new S.Store();
  const $ = (id) => document.getElementById(id);

  const state = { query: '', folder: '', selectedId: null, aiIds: null, aiNote: '', genTarget: null };

  // ---------- tiny DOM helper / 简易 DOM 构建工具 ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // Turn an error into a message in the current language (errors carry a `code` or HTTP `status`).
  // 把错误转换为当前语言的提示（错误对象带有 `code` 或 HTTP `status`）。
  function errText(e) {
    if (e && e.code) return t('err.' + e.code, e.vars);
    if (e && e.status === 0) return t('err.OFFLINE');
    if (e && e.status === 401) return t('err.WRONG_LOGIN');
    if (e && e.status === 403) return t('err.REG_DISABLED');
    if (e && e.status === 409) return t('err.TAKEN');
    if (e && e.status === 429) return t('err.TOO_MANY');
    return (e && e.message) || String(e);
  }

  async function busy(btn, fn) {
    const prev = btn.innerHTML; // our own static markup, safe to restore / 只是我们自己的静态标记，可安全恢复
    btn.disabled = true;
    btn.textContent = '…';
    try { return await fn(); }
    catch (e) { toast(errText(e)); throw e; }
    finally { btn.disabled = false; btn.innerHTML = prev; }
  }

  function colorFor(s) {
    let x = 0;
    for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return 'hsl(' + (x % 360) + ' 55% 45%)';
  }
  function avatar(e) {
    const el = h('span', { class: 'avatar', 'aria-hidden': 'true' }, (e.title || '?').trim().charAt(0).toUpperCase() || '?');
    el.style.background = colorFor(e.title || '?'); // CSSOM, allowed by the strict CSP / 通过 CSSOM 设置，严格的 CSP 允许
    return el;
  }
  function strengthLabel(pw) { return t('strength' + C.strength(pw).score); }
  function setMeter(bar, label, pw) {
    const s = C.strength(pw);
    bar.style.width = pw ? (20 + s.score * 20) + '%' : '0';
    bar.style.background = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--ok)', 'var(--ok)'][s.score];
    if (label) label.textContent = pw ? strengthLabel(pw) + ' · ' + t('bits', { n: s.bits }) : '';
  }
  // AI settings plus the UI language, so AI answers come back in the user's language.
  // AI 设置加上界面语言，让 AI 用用户的语言回答。
  function aiCfg() { return Object.assign({}, ai.DEFAULTS, store.settings.ai, { language: i18n.aiLanguage }); }
  function setting(k, dflt) { const v = store.settings[k]; return v == null ? dflt : v; }

  // ---------- language pickers / 语言选择器 ----------
  function fillLangSelect(sel) {
    sel.replaceChildren(...Object.entries(i18n.LANGS).map(([code, [name]]) => h('option', { value: code }, name)));
    sel.value = i18n.lang;
    sel.addEventListener('change', () => i18n.set(sel.value));
  }
  fillLangSelect($('langLock'));
  fillLangSelect($('langSettings'));
  i18n.onChange(() => {
    $('langLock').value = $('langSettings').value = i18n.lang;
    renderStatus();
    if (store.isUnlocked) render();
  });
  i18n.apply();

  // ---------- clipboard with auto-clear / 剪贴板（自动清除） ----------
  let clipTimer;
  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      toast(t('clipBlocked')); return;
    }
    const secs = setting('clipClear', 30);
    toast(t('clipClears', { what: what || t('copiedGeneric'), n: secs }));
    clearTimeout(clipTimer);
    clipTimer = setTimeout(async () => {
      try {
        const cur = await navigator.clipboard.readText().catch(() => text);
        if (cur === text) await navigator.clipboard.writeText('');
      } catch (e) { /* page not focused; best effort / 页面未获得焦点，尽力而为 */ }
    }, secs * 1000);
  }

  // ---------- auto-lock / 自动锁定 ----------
  let lastActive = Date.now();
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (store.isUnlocked && Date.now() - lastActive > setting('autoLock', 10) * 60000) lock();
  }, 15000);

  // ================= LOCK SCREEN / 锁定界面 =================
  const profile = S.Store.lastProfile();
  if (profile) {
    $('lUser').value = profile.username || '';
    $('lServer').value = profile.serverUrl || '';
    if (profile.serverUrl) $('serverBox').open = true;
    $('lPass').focus();
  } else {
    $('lUser').focus();
  }
  // When served by the sync server itself (PWA), suggest this origin as the server URL.
  // 如果页面由同步服务器本身提供（PWA），把当前地址作为服务器地址的提示。
  if (!$('lServer').value && /^https?:$/.test(location.protocol) && !/tauri/.test(location.host) && location.port !== '47821') {
    $('lServer').placeholder = location.origin;
  }

  async function doUnlock(create) {
    const err = $('lErr');
    err.hidden = true;
    const btn = create ? $('btnCreate') : $('btnUnlock');
    if (create && !confirm(t('confirmCreate', { user: $('lUser').value.trim() }))) return;
    btn.disabled = true;
    btn.textContent = create ? t('creating') : t('unlocking');
    try {
      await store.unlock({ username: $('lUser').value, password: $('lPass').value, serverUrl: $('lServer').value.trim(), create });
      $('lPass').value = '';
      showApp();
    } catch (e) {
      err.textContent = errText(e);
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = create ? t('createVault') : t('unlock');
    }
  }
  $('lockForm').addEventListener('submit', (e) => { e.preventDefault(); doUnlock(false); });
  $('btnCreate').addEventListener('click', () => { if ($('lockForm').reportValidity()) doUnlock(true); });

  function showApp() {
    $('lock').hidden = true;
    $('app').hidden = false;
    lastActive = Date.now();
    render();
    $('q').focus();
  }
  function lock() {
    store.lock();
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    Object.assign(state, { query: '', selectedId: null, aiIds: null });
    $('q').value = '';
    $('list').replaceChildren();
    $('detail').replaceChildren();
    $('app').hidden = true;
    $('lock').hidden = false;
    $('lPass').focus();
  }

  // ================= MAIN VIEW / 主界面 =================
  function renderStatus() {
    const pill = $('syncPill');
    pill.textContent = t('status.' + store.status);
    pill.className = 'pill ' + store.status;
    pill.title = store.statusDetail || t('syncStatus');
  }
  store.on(() => {
    renderStatus();
    if (store.isUnlocked && !$('app').hidden) render();
  });
  renderStatus();

  function visibleEntries() {
    let list = store.entries;
    if (state.folder) list = list.filter((e) => (e.folder || '') === state.folder);
    if (state.aiIds) {
      const byId = new Map(list.map((e) => [e.id, e]));
      return state.aiIds.map((id) => byId.get(id)).filter(Boolean);
    }
    if (state.query.trim()) return fuzzy.search(list, state.query).map((r) => r.entry);
    return list.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', i18n.locale, { sensitivity: 'base' }));
  }

  function render() {
    // folder chips / 文件夹筛选按钮
    const folders = Array.from(new Set(store.entries.map((e) => e.folder).filter(Boolean))).sort();
    const chips = [h('button', { 'aria-pressed': String(!state.folder), onclick: () => { state.folder = ''; render(); } }, t('all', { n: store.entries.length }))];
    for (const f of folders) {
      chips.push(h('button', { 'aria-pressed': String(state.folder === f), onclick: () => { state.folder = state.folder === f ? '' : f; render(); } }, f));
    }
    $('folders').replaceChildren(...chips);
    $('folders').hidden = folders.length === 0;
    $('folderList').replaceChildren(...folders.map((f) => h('option', { value: f })));

    // AI banner / AI 结果横幅
    const banner = $('aiBanner');
    banner.hidden = !state.aiIds;
    if (state.aiIds) {
      banner.replaceChildren(h('span', null, '✨ ' + (state.aiNote || t('aiResults'))),
        h('button', { onclick: clearAi }, t('clear')));
    }

    // item list / 条目列表
    const items = visibleEntries();
    const list = $('list');
    if (!items.length) {
      list.replaceChildren(h('div', { class: 'empty' }, store.entries.length ? t('noMatches') : t('emptyVault')));
    } else {
      list.replaceChildren(...items.map((e) => h('div', {
        class: 'item' + (e.id === state.selectedId ? ' active' : ''), tabindex: '0', role: 'button',
        onclick: () => select(e.id),
        onkeydown: (ev) => { if (ev.key === 'Enter') select(e.id); },
      }, avatar(e), h('div', null, h('div', { class: 't' }, e.title || t('untitled')), h('div', { class: 's' }, e.username || ai.domainOf(e.url) || '')))));
    }
    renderDetail();
  }

  function select(id) { state.selectedId = id; render(); }

  function field(label, value, opts) {
    opts = opts || {};
    const v = h('div', { class: 'v' + (opts.mono ? ' mono' : '') }, opts.secret ? '••••••••••••' : value);
    let shown = false;
    return h('div', { class: 'field' },
      h('div', { class: 'grow' }, h('div', { class: 'k' }, opts.caption || label), v),
      opts.secret && h('button', { title: t('showHide'), onclick: () => { shown = !shown; v.textContent = shown ? value : '••••••••••••'; } }, '👁'),
      opts.open && h('button', { title: t('openSite'), onclick: () => window.open(opts.open, '_blank', 'noopener,noreferrer') }, '↗'),
      opts.copy !== false && h('button', { title: t('copy'), onclick: () => copy(value, t('copiedField', { what: label })) }, '⧉'));
  }

  function renderDetail() {
    const d = $('detail');
    const e = store.entries.find((x) => x.id === state.selectedId);
    if (!e) { d.replaceChildren(); return; }
    const href = e.url ? (/^[a-z]+:\/\//i.test(e.url) ? e.url : 'https://' + e.url) : null;
    d.replaceChildren(
      h('button', { class: 'back', onclick: () => { state.selectedId = null; render(); } }, t('back')),
      h('div', { class: 'd-head' }, avatar(e), h('div', { class: 'grow' }, h('h2', null, e.title || t('untitled')),
        h('div', { class: 'muted small' }, [e.folder, ai.domainOf(e.url)].filter(Boolean).join(' · ')))),
      e.username && field(t('field.username'), e.username),
      e.password && field(t('field.password'), e.password,
        { secret: true, mono: true, caption: t('field.password') + ' · ' + strengthLabel(e.password) }),
      e.url && field(t('field.website'), e.url, { open: /^https?:\/\//i.test(href) ? href : null }),
      e.notes && field(t('field.notes'), e.notes),
      (e.tags || []).length > 0 && h('div', { class: 'tags' }, e.tags.map((tag) => h('span', { class: 'tag' }, '#' + tag))),
      h('p', { class: 'muted small' }, t('updated', { date: new Date(e.updatedAt).toLocaleString(i18n.locale) })),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => openEditor(e) }, t('edit')),
        h('button', { class: 'danger', onclick: async () => {
          if (!confirm(t('confirmDelete', { title: e.title || t('thisItem') }))) return;
          await store.remove(e.id);
          state.selectedId = null;
          toast(t('deleted'));
        } }, t('delete'))));
  }

  // search / 搜索
  $('q').addEventListener('input', (e) => { state.query = e.target.value; state.aiIds = null; render(); });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); $('btnAsk').click(); }
    else if (e.key === 'Enter') { const first = visibleEntries()[0]; if (first) select(first.id); }
    else if (e.key === 'Escape') { e.target.value = ''; state.query = ''; clearAi(); }
  });
  document.addEventListener('keydown', (e) => {
    if (!store.isUnlocked) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('q').focus(); $('q').select(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); }
  });
  function clearAi() { state.aiIds = null; state.aiNote = ''; render(); }
  // Gamepad Y (js/gamepad.js): copy the selected item's password, or the top search hit's.
  // 手柄 Y 键（js/gamepad.js）：复制选中条目的密码，没有选中时复制第一个搜索结果的密码。
  document.addEventListener('cloudvault:copy-password', () => {
    const e = store.entries.find((x) => x.id === state.selectedId) || visibleEntries()[0];
    if (!e || !e.password) { toast(t('noMatches')); return; }
    if (e.id !== state.selectedId) select(e.id);
    copy(e.password, t('passwordCopied'));
  });

  // ================= EDITOR / 编辑器 =================
  // Note: use ef.elements.x — `ef.title` would be the form's own title attribute.
  // 注意：要用 ef.elements.x —— `ef.title` 取到的是表单自身的 title 属性。
  const ef = $('editForm');
  function openEditor(entry) {
    ef.reset();
    ef.dataset.id = entry ? entry.id : '';
    $('editTitle').textContent = entry ? t('editItem') : t('newItem');
    $('editErr').hidden = true;
    ef.elements.password.type = 'password';
    if (entry) {
      for (const k of ['title', 'url', 'username', 'password', 'folder', 'notes']) ef.elements[k].value = entry[k] || '';
      ef.elements.tags.value = (entry.tags || []).join(', ');
    } else if (state.folder) {
      ef.elements.folder.value = state.folder;
    }
    setMeter($('editMeter'), $('editMeterLabel'), ef.elements.password.value);
    $('dlgEdit').showModal();
    ef.elements.title.focus();
  }
  $('btnNew').addEventListener('click', () => openEditor(null));
  ef.elements.password.addEventListener('input', () => setMeter($('editMeter'), $('editMeterLabel'), ef.elements.password.value));
  ef.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'cancel') $('dlgEdit').close();
    if (a === 'toggle') ef.elements.password.type = ef.elements.password.type === 'password' ? 'text' : 'password';
    if (a === 'gen') openGenerator((pw) => { ef.elements.password.value = pw; ef.elements.password.type = 'text'; setMeter($('editMeter'), $('editMeterLabel'), pw); });
    if (a === 'suggest') {
      if (!ef.elements.title.value && !ef.elements.url.value) { toast(t('needTitleOrUrl')); return; }
      await busy(act, async () => {
        const r = await ai.suggestFor(aiCfg(), { title: ef.elements.title.value, url: ef.elements.url.value });
        if (r.title) ef.elements.title.value = r.title;
        if (r.folder && !ef.elements.folder.value) ef.elements.folder.value = r.folder;
        if (r.tags && r.tags.length && !ef.elements.tags.value) ef.elements.tags.value = r.tags.join(', ');
        toast(t('suggestionsApplied'));
      }).catch(() => {});
    }
  });
  ef.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = ef.dataset.id;
    const prev = id && store.entries.find((x) => x.id === id);
    const fields = {
      title: ef.elements.title.value.trim(), url: ef.elements.url.value.trim(), username: ef.elements.username.value.trim(),
      password: ef.elements.password.value, folder: ef.elements.folder.value.trim(), notes: ef.elements.notes.value,
      // accept both ASCII and full-width commas / 同时支持半角和全角逗号
      tags: ef.elements.tags.value.split(/[,，、]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean),
    };
    if (id) fields.id = id;
    if (!prev || prev.password !== fields.password) fields.pwChangedAt = Date.now();
    const saved = await store.upsert(fields);
    state.selectedId = saved.id;
    $('dlgEdit').close();
    toast(t('saved'));
  });

  // ================= GENERATOR / 密码生成器 =================
  function genOpts() {
    return { length: +$('genLen').value, lower: $('genLower').checked, upper: $('genUpper').checked, digits: $('genDigits').checked, symbols: $('genSymbols').checked };
  }
  function regen() {
    const pw = C.generatePassword(genOpts());
    $('genOut').textContent = pw;
    $('genLenVal').textContent = $('genLen').value;
    setMeter($('genMeter'), null, pw);
  }
  function openGenerator(onUse) {
    state.genTarget = onUse || null;
    $('genUse').hidden = !onUse;
    $('genCopy').hidden = !!onUse;
    regen();
    $('dlgGen').showModal();
  }
  ['genLen', 'genLower', 'genUpper', 'genDigits', 'genSymbols'].forEach((id) => $(id).addEventListener('input', regen));
  $('genAgain').addEventListener('click', regen);
  $('genClose').addEventListener('click', () => $('dlgGen').close());
  $('genCopy').addEventListener('click', () => copy($('genOut').textContent, t('passwordCopied')));
  $('genUse').addEventListener('click', () => { if (state.genTarget) state.genTarget($('genOut').textContent); $('dlgGen').close(); });
  $('btnGen').addEventListener('click', () => openGenerator(null));

  // ================= SETTINGS / 设置 =================
  const sf = $('setForm');
  function syncProviderVisibility() {
    for (const el of sf.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== sf.provider.value;
  }
  $('btnSettings').addEventListener('click', () => {
    const c = aiCfg();
    for (const k of ['provider', 'apiKey', 'model', 'ollamaUrl', 'ollamaModel']) sf[k].value = c[k] || '';
    sf.autoLock.value = setting('autoLock', 10);
    sf.clipClear.value = setting('clipClear', 30);
    $('langSettings').value = i18n.lang;
    syncProviderVisibility();
    $('dlgSettings').showModal();
  });
  sf.provider.addEventListener('change', syncProviderVisibility);
  sf.addEventListener('submit', async (e) => {
    e.preventDefault();
    await store.setSettings({
      ai: { provider: sf.provider.value, apiKey: sf.apiKey.value.trim(), model: sf.model.value.trim() || ai.DEFAULTS.model,
        ollamaUrl: sf.ollamaUrl.value.trim() || ai.DEFAULTS.ollamaUrl, ollamaModel: sf.ollamaModel.value.trim() || ai.DEFAULTS.ollamaModel },
      autoLock: Math.max(1, +sf.autoLock.value || 10),
      clipClear: Math.max(5, +sf.clipClear.value || 30),
    });
    $('dlgSettings').close();
    toast(t('settingsSaved'));
  });
  sf.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'cancel') $('dlgSettings').close();
    if (a === 'syncNow') {
      if (!store.api) { toast(t('deviceOnly')); return; }
      await store.sync();
      toast(store.status === 'synced' ? t('syncedToast') : t('syncFailed', { detail: store.lastError ? errText(store.lastError) : t('status.' + store.status) }));
    }
    if (a === 'export') {
      const blob = new Blob([JSON.stringify({ app: 'cloudvault', username: store.username, envelope: store.envelope }, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      h('a', { href: url, download: 'cloudvault-backup-' + new Date().toISOString().slice(0, 10) + '.json' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(t('backupDone'));
    }
    if (a === 'forget') {
      if (!confirm(store.api ? t('confirmForgetCloud') : t('confirmForgetLocal'))) return;
      store.forgetDevice();
      lock();
      $('lUser').value = '';
    }
  });
  $('previewAi').addEventListener('click', (e) => {
    e.preventDefault();
    showAi(t('aiPreviewTitle'), [
      h('p', { class: 'muted small' }, t('aiPreviewNote')),
      h('pre', { class: 'preview mono' }, JSON.stringify(ai.redact(store.entries), null, 2)),
    ]);
  });

  // CSV import (RFC 4180 quoting) / CSV 导入（支持 RFC 4180 引号规则）
  function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
    text = text.replace(/^﻿/, ''); // strip UTF-8 BOM (common in Excel exports) / 去掉 UTF-8 BOM（Excel 导出常见）
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); rows.push(row); row = []; cur = '';
      } else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim()));
  }
  $('csvFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const rows = parseCsv(await file.text());
    const head = (rows.shift() || []).map((x) => x.trim().toLowerCase());
    const col = (...names) => head.findIndex((x) => names.includes(x));
    const idx = {
      title: col('name', 'title'), url: col('url', 'login_uri', 'website'), username: col('username', 'login_username', 'email'),
      password: col('password', 'login_password'), notes: col('notes', 'note', 'extra'), folder: col('folder', 'grouping', 'group'),
    };
    if (idx.password < 0) { toast(t('csvNeedsPw')); return; }
    const now = Date.now();
    let n = 0;
    for (const r of rows) {
      const get = (k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
      const entry = { id: S.uuid(), title: get('title') || ai.domainOf(get('url')) || t('importedTitle'), url: get('url'), username: get('username'),
        password: r[idx.password] || '', notes: get('notes'), folder: get('folder'), tags: [], createdAt: now, updatedAt: now, pwChangedAt: now };
      store.vault.entries.push(entry);
      n++;
    }
    await store.save();
    $('dlgSettings').close();
    toast(t('imported', { n }));
  });

  // ================= ONE-CLICK AI / 一键 AI =================
  function showAi(title, body, onApply) {
    $('aiTitle').textContent = title;
    $('aiBody').replaceChildren(...[].concat(body));
    $('aiApply').hidden = !onApply;
    $('aiApply').onclick = onApply ? async () => { await onApply(); $('dlgAi').close(); } : null;
    if (!$('dlgAi').open) $('dlgAi').showModal();
  }
  $('aiClose').addEventListener('click', () => $('dlgAi').close());
  function needEntries() {
    if (!store.entries.length) { toast(t('addItemsFirst')); return false; }
    return true;
  }

  // Plain-words search / 自然语言搜索
  $('btnAsk').addEventListener('click', () => {
    const q = $('q').value.trim();
    if (!q) { toast(t('askHint')); $('q').focus(); return; }
    if (!needEntries()) return;
    busy($('btnAsk'), async () => {
      const r = await ai.smartSearch(aiCfg(), q, store.entries);
      state.aiIds = r.ids;
      state.aiNote = r.explanation || t('aiResultsFor', { n: r.ids.length, q });
      if (r.ids[0]) state.selectedId = r.ids[0];
      render();
    }).catch(() => {});
  });

  // Security audit / 安全检查
  $('btnAudit').addEventListener('click', () => {
    if (!needEntries()) return;
    busy($('btnAudit'), async () => {
      const r = await ai.audit(aiCfg(), store.entries);
      const byId = new Map(store.entries.map((e) => [e.id, e]));
      showAi(t('auditDlg'), [
        h('div', { class: 'row' }, h('span', { class: 'score' }, String(r.score)), h('span', { class: 'muted' }, t('vaultHealth'))),
        h('p', null, r.summary),
        ...(r.findings || []).map((f) => {
          const e = byId.get(f.id);
          return h('div', { class: 'finding ' + f.severity, onclick: () => { if (e) { $('dlgAi').close(); select(e.id); } } },
            h('b', null, (e ? e.title + ': ' : '') + f.issue), h('div', { class: 'muted small' }, '→ ' + f.fix));
        }),
      ]);
    }).catch(() => {});
  });

  // Organize: preview first, apply only on confirmation / 整理：先预览，确认后才应用
  $('btnOrganize').addEventListener('click', () => {
    if (!needEntries()) return;
    busy($('btnOrganize'), async () => {
      const items = await ai.organize(aiCfg(), store.entries);
      const byId = new Map(store.entries.map((e) => [e.id, e]));
      const changes = items.filter((s) => byId.has(s.id));
      showAi(t('organizeDlg'), [
        h('p', { class: 'muted small' }, t('organizeNote')),
        h('table', { class: 'org-table' }, changes.map((s) => h('tr', null,
          h('td', null, byId.get(s.id).title), h('td', null, s.folder), h('td', { class: 'muted' }, (s.tags || []).map((x) => '#' + x).join(' '))))),
      ], async () => {
        const now = Date.now();
        for (const s of changes) Object.assign(byId.get(s.id), { folder: s.folder, tags: s.tags || [], updatedAt: now });
        await store.save();
        toast(t('organized', { n: changes.length }));
      });
    }).catch(() => {});
  });

  $('btnLock').addEventListener('click', lock);

  // ================= PWA =================
  // Skipped inside native shells: Tauri and the Windows launcher (localhost:47821) already ship every file.
  // 在原生外壳中跳过：Tauri 和 Windows 启动器（localhost:47821）已自带所有文件。
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/tauri/.test(location.host) && location.port !== '47821') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
