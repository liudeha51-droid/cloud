// CloudVault UI controller. All user data is rendered with textContent (never innerHTML).
(function () {
  'use strict';
  const { crypto: C, fuzzy, ai, store: S } = window.PV;
  const store = new S.Store();
  const $ = (id) => document.getElementById(id);

  const state = { query: '', folder: '', selectedId: null, aiIds: null, aiNote: '', genTarget: null };

  // ---------- tiny DOM helper ----------
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
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  async function busy(btn, fn) {
    const prev = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '…';
    try { return await fn(); }
    catch (e) { toast(e.message || String(e)); throw e; }
    finally { btn.disabled = false; btn.innerHTML = prev; }
  }

  function colorFor(s) {
    let x = 0;
    for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return 'hsl(' + (x % 360) + ' 55% 45%)';
  }
  function avatar(e) {
    const el = h('span', { class: 'avatar', 'aria-hidden': 'true' }, (e.title || '?').trim().charAt(0).toUpperCase() || '?');
    el.style.background = colorFor(e.title || '?'); // CSSOM, allowed by the strict CSP
    return el;
  }
  function setMeter(bar, label, pw) {
    const s = C.strength(pw);
    bar.style.width = pw ? (20 + s.score * 20) + '%' : '0';
    bar.style.background = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--ok)', 'var(--ok)'][s.score];
    if (label) label.textContent = pw ? s.label + ' · ~' + s.bits + ' bits' : '';
  }
  function aiCfg() { return Object.assign({}, ai.DEFAULTS, store.settings.ai); }
  function setting(k, dflt) { const v = store.settings[k]; return v == null ? dflt : v; }

  // ---------- clipboard with auto-clear ----------
  let clipTimer;
  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      toast('Clipboard blocked by this browser'); return;
    }
    const secs = setting('clipClear', 30);
    toast((what || 'Copied') + ' — clears in ' + secs + 's');
    clearTimeout(clipTimer);
    clipTimer = setTimeout(async () => {
      try {
        const cur = await navigator.clipboard.readText().catch(() => text);
        if (cur === text) await navigator.clipboard.writeText('');
      } catch (e) { /* page not focused; best effort */ }
    }, secs * 1000);
  }

  // ---------- auto-lock ----------
  let lastActive = Date.now();
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (store.isUnlocked && Date.now() - lastActive > setting('autoLock', 10) * 60000) lock();
  }, 15000);

  // ================= LOCK SCREEN =================
  const profile = S.Store.lastProfile();
  if (profile) {
    $('lUser').value = profile.username || '';
    $('lServer').value = profile.serverUrl || '';
    if (profile.serverUrl) $('serverBox').open = true;
    $('lPass').focus();
  } else {
    $('lUser').focus();
  }
  // When served by the sync server itself (PWA), default the server URL to this origin.
  if (!$('lServer').value && /^https?:$/.test(location.protocol) && !/tauri/.test(location.host)) {
    $('lServer').placeholder = location.origin;
  }

  async function doUnlock(create) {
    const err = $('lErr');
    err.hidden = true;
    const btn = create ? $('btnCreate') : $('btnUnlock');
    if (create && !confirm('Create a new vault for "' + $('lUser').value.trim() + '"?\n\nWrite your master password down somewhere safe — it cannot be recovered.')) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = create ? 'Creating…' : 'Unlocking…';
    try {
      await store.unlock({ username: $('lUser').value, password: $('lPass').value, serverUrl: $('lServer').value.trim(), create });
      $('lPass').value = '';
      showApp();
    } catch (e) {
      err.textContent = e.message || String(e);
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
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

  // ================= MAIN VIEW =================
  store.on(() => {
    const pill = $('syncPill');
    const labels = { local: 'device only', synced: '✓ synced', syncing: 'syncing…', offline: 'offline', error: 'sync error' };
    pill.textContent = labels[store.status] || store.status;
    pill.className = 'pill ' + store.status;
    pill.title = store.statusDetail || '';
    if (store.isUnlocked && !$('app').hidden) render();
  });

  function visibleEntries() {
    let list = store.entries;
    if (state.folder) list = list.filter((e) => (e.folder || '') === state.folder);
    if (state.aiIds) {
      const byId = new Map(list.map((e) => [e.id, e]));
      return state.aiIds.map((id) => byId.get(id)).filter(Boolean);
    }
    if (state.query.trim()) return fuzzy.search(list, state.query).map((r) => r.entry);
    return list.slice().sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  }

  function render() {
    // folder chips
    const folders = Array.from(new Set(store.entries.map((e) => e.folder).filter(Boolean))).sort();
    const chips = [h('button', { 'aria-pressed': String(!state.folder), onclick: () => { state.folder = ''; render(); } }, 'All ' + store.entries.length)];
    for (const f of folders) {
      chips.push(h('button', { 'aria-pressed': String(state.folder === f), onclick: () => { state.folder = state.folder === f ? '' : f; render(); } }, f));
    }
    $('folders').replaceChildren(...chips);
    $('folders').hidden = folders.length === 0;
    $('folderList').replaceChildren(...folders.map((f) => h('option', { value: f })));

    // AI banner
    const banner = $('aiBanner');
    banner.hidden = !state.aiIds;
    if (state.aiIds) {
      banner.replaceChildren(h('span', null, '✨ ' + (state.aiNote || 'AI results')),
        h('button', { onclick: clearAi }, 'Clear'));
    }

    // list
    const items = visibleEntries();
    const list = $('list');
    if (!items.length) {
      list.replaceChildren(h('div', { class: 'empty' },
        store.entries.length ? 'No matches. Try ✨ Ask AI for a plain-words search.' : 'Your vault is empty. Click ＋ to add your first login, or import a CSV in ⚙ Settings.'));
    } else {
      list.replaceChildren(...items.map((e) => h('div', {
        class: 'item' + (e.id === state.selectedId ? ' active' : ''), tabindex: '0', role: 'button',
        onclick: () => select(e.id),
        onkeydown: (ev) => { if (ev.key === 'Enter') select(e.id); },
      }, avatar(e), h('div', null, h('div', { class: 't' }, e.title || '(untitled)'), h('div', { class: 's' }, e.username || ai.domainOf(e.url) || '')))));
    }
    renderDetail();
  }

  function select(id) { state.selectedId = id; render(); }

  function field(label, value, opts) {
    opts = opts || {};
    const v = h('div', { class: 'v' + (opts.mono ? ' mono' : '') }, opts.secret ? '••••••••••••' : value);
    let shown = false;
    return h('div', { class: 'field' },
      h('div', { class: 'grow' }, h('div', { class: 'k' }, label), v),
      opts.secret && h('button', { title: 'Show / hide', onclick: () => { shown = !shown; v.textContent = shown ? value : '••••••••••••'; } }, '👁'),
      opts.open && h('button', { title: 'Open website', onclick: () => window.open(opts.open, '_blank', 'noopener,noreferrer') }, '↗'),
      opts.copy !== false && h('button', { title: 'Copy', onclick: () => copy(value, label + ' copied') }, '⧉'));
  }

  function renderDetail() {
    const d = $('detail');
    const e = store.entries.find((x) => x.id === state.selectedId);
    if (!e) { d.replaceChildren(); return; }
    const href = e.url ? (/^[a-z]+:\/\//i.test(e.url) ? e.url : 'https://' + e.url) : null;
    const s = C.strength(e.password);
    d.replaceChildren(
      h('button', { class: 'back', onclick: () => { state.selectedId = null; render(); } }, '← Back'),
      h('div', { class: 'd-head' }, avatar(e), h('div', { class: 'grow' }, h('h2', null, e.title || '(untitled)'),
        h('div', { class: 'muted small' }, [e.folder, ai.domainOf(e.url)].filter(Boolean).join(' · ')))),
      e.username && field('Username', e.username),
      e.password && field('Password · ' + s.label, e.password, { secret: true, mono: true }),
      e.url && field('Website', e.url, { open: /^https?:\/\//i.test(href) ? href : null }),
      e.notes && field('Notes', e.notes),
      (e.tags || []).length > 0 && h('div', { class: 'tags' }, e.tags.map((t) => h('span', { class: 'tag' }, '#' + t))),
      h('p', { class: 'muted small' }, 'Updated ' + new Date(e.updatedAt).toLocaleString()),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => openEditor(e) }, '✎ Edit'),
        h('button', { class: 'danger', onclick: async () => {
          if (!confirm('Delete "' + (e.title || 'this item') + '"?')) return;
          await store.remove(e.id);
          state.selectedId = null;
          toast('Deleted');
        } }, '🗑 Delete')));
  }

  // search
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

  // ================= EDITOR =================
  const ef = $('editForm');
  function openEditor(entry) {
    ef.reset();
    ef.dataset.id = entry ? entry.id : '';
    $('editTitle').textContent = entry ? 'Edit item' : 'New item';
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
      if (!ef.elements.title.value && !ef.elements.url.value) { toast('Enter a title or website first'); return; }
      await busy(act, async () => {
        const r = await ai.suggestFor(aiCfg(), { title: ef.elements.title.value, url: ef.elements.url.value });
        if (r.title) ef.elements.title.value = r.title;
        if (r.folder && !ef.elements.folder.value) ef.elements.folder.value = r.folder;
        if (r.tags && r.tags.length && !ef.elements.tags.value) ef.elements.tags.value = r.tags.join(', ');
        toast('✨ Suggestions applied');
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
      tags: ef.elements.tags.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
    };
    if (id) fields.id = id;
    if (!prev || prev.password !== fields.password) fields.pwChangedAt = Date.now();
    const saved = await store.upsert(fields);
    state.selectedId = saved.id;
    $('dlgEdit').close();
    toast('Saved');
  });

  // ================= GENERATOR =================
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
  $('genCopy').addEventListener('click', () => copy($('genOut').textContent, 'Password copied'));
  $('genUse').addEventListener('click', () => { if (state.genTarget) state.genTarget($('genOut').textContent); $('dlgGen').close(); });
  $('btnGen').addEventListener('click', () => openGenerator(null));

  // ================= SETTINGS =================
  const sf = $('setForm');
  function syncProviderVisibility() {
    for (const el of sf.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== sf.provider.value;
  }
  $('btnSettings').addEventListener('click', () => {
    const c = aiCfg();
    for (const k of ['provider', 'apiKey', 'model', 'ollamaUrl', 'ollamaModel']) sf[k].value = c[k] || '';
    sf.autoLock.value = setting('autoLock', 10);
    sf.clipClear.value = setting('clipClear', 30);
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
    toast('Settings saved (encrypted)');
  });
  sf.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const a = act.dataset.act;
    if (a === 'cancel') $('dlgSettings').close();
    if (a === 'syncNow') {
      if (!store.api) { toast('This vault is device-only (no sync server)'); return; }
      await store.sync();
      toast(store.status === 'synced' ? 'Synced' : 'Sync: ' + (store.statusDetail || store.status));
    }
    if (a === 'export') {
      const blob = new Blob([JSON.stringify({ app: 'cloudvault', username: store.username, envelope: store.envelope }, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      h('a', { href: url, download: 'cloudvault-backup-' + new Date().toISOString().slice(0, 10) + '.json' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Encrypted backup downloaded');
    }
    if (a === 'forget') {
      if (!confirm('Remove the encrypted vault copy from this device? ' + (store.api ? 'Your cloud copy is kept.' : 'THIS VAULT HAS NO SYNC SERVER — it will be gone for good.'))) return;
      store.forgetDevice();
      lock();
      $('lUser').value = '';
    }
  });
  $('previewAi').addEventListener('click', (e) => {
    e.preventDefault();
    showAi('What your AI receives', [
      h('p', { class: 'muted small' }, 'This is the exact data every AI action can see. No passwords, usernames, full URLs or notes.'),
      h('pre', { class: 'preview mono' }, JSON.stringify(ai.redact(store.entries), null, 2)),
    ]);
  });

  // CSV import
  function parseCsv(text) {
    const rows = [];
    let row = [], cur = '', q = false;
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
    if (idx.password < 0) { toast('CSV needs a "password" column'); return; }
    const now = Date.now();
    let n = 0;
    for (const r of rows) {
      const get = (k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
      const entry = { id: S.uuid(), title: get('title') || ai.domainOf(get('url')) || 'Imported', url: get('url'), username: get('username'),
        password: r[idx.password] || '', notes: get('notes'), folder: get('folder'), tags: [], createdAt: now, updatedAt: now, pwChangedAt: now };
      store.vault.entries.push(entry);
      n++;
    }
    await store.save();
    $('dlgSettings').close();
    toast('Imported ' + n + ' items — delete the CSV file now, it is unencrypted!');
  });

  // ================= ONE-CLICK AI =================
  function showAi(title, body, onApply) {
    $('aiTitle').textContent = title;
    $('aiBody').replaceChildren(...[].concat(body));
    $('aiApply').hidden = !onApply;
    $('aiApply').onclick = onApply ? async () => { await onApply(); $('dlgAi').close(); } : null;
    if (!$('dlgAi').open) $('dlgAi').showModal();
  }
  $('aiClose').addEventListener('click', () => $('dlgAi').close());
  function needEntries() {
    if (!store.entries.length) { toast('Add some items first'); return false; }
    return true;
  }

  $('btnAsk').addEventListener('click', () => {
    const q = $('q').value.trim();
    if (!q) { toast('Type what you are looking for, e.g. "where do I pay my phone bill"'); $('q').focus(); return; }
    if (!needEntries()) return;
    busy($('btnAsk'), async () => {
      const r = await ai.smartSearch(aiCfg(), q, store.entries);
      state.aiIds = r.ids;
      state.aiNote = r.explanation || (r.ids.length + ' result(s) for "' + q + '"');
      if (r.ids[0]) state.selectedId = r.ids[0];
      render();
    }).catch(() => {});
  });

  $('btnAudit').addEventListener('click', () => {
    if (!needEntries()) return;
    busy($('btnAudit'), async () => {
      const r = await ai.audit(aiCfg(), store.entries);
      const byId = new Map(store.entries.map((e) => [e.id, e]));
      showAi('🛡 Security audit', [
        h('div', { class: 'row' }, h('span', { class: 'score' }, String(r.score)), h('span', { class: 'muted' }, '/ 100 vault health')),
        h('p', null, r.summary),
        ...(r.findings || []).map((f) => {
          const e = byId.get(f.id);
          return h('div', { class: 'finding ' + f.severity, onclick: () => { if (e) { $('dlgAi').close(); select(e.id); } } },
            h('b', null, (e ? e.title + ': ' : '') + f.issue), h('div', { class: 'muted small' }, '→ ' + f.fix));
        }),
      ]);
    }).catch(() => {});
  });

  $('btnOrganize').addEventListener('click', () => {
    if (!needEntries()) return;
    busy($('btnOrganize'), async () => {
      const items = await ai.organize(aiCfg(), store.entries);
      const byId = new Map(store.entries.map((e) => [e.id, e]));
      const changes = items.filter((s) => byId.has(s.id));
      showAi('🏷 Organize — review suggestions', [
        h('p', { class: 'muted small' }, 'Nothing changes until you click Apply all.'),
        h('table', { class: 'org-table' }, changes.map((s) => h('tr', null,
          h('td', null, byId.get(s.id).title), h('td', null, s.folder), h('td', { class: 'muted' }, (s.tags || []).map((t) => '#' + t).join(' '))))),
      ], async () => {
        const now = Date.now();
        for (const s of changes) Object.assign(byId.get(s.id), { folder: s.folder, tags: s.tags || [], updatedAt: now });
        await store.save();
        toast('Organized ' + changes.length + ' items');
      });
    }).catch(() => {});
  });

  $('btnLock').addEventListener('click', lock);

  // ================= PWA =================
  // Skipped inside native shells: Tauri and the Windows launcher (localhost:47821) already ship every file.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !/tauri/.test(location.host) && location.port !== '47821') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
