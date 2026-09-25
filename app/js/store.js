// CloudVault store — offline-first encrypted vault with optional cloud sync.
// CloudVault 存储层 —— 离线优先的加密密码库，可选云同步。
//
// Vault shape (only ever stored/transmitted encrypted):
// 密码库结构（只以加密形式存储或传输）：
//   { entries: [{ id, title, username, password, url, notes, tags[], folder, createdAt, updatedAt, deleted? }],
//     settings: { ai: {...} } }
// Deleted entries are kept as tombstones so deletions propagate between devices.
// 已删除的条目会保留为“墓碑”，这样删除操作才能同步到其他设备。
(function (root) {
  'use strict';
  const C = root.PV.crypto;
  const LS_PREFIX = 'cloudvault:';

  function lsGet(k) { try { return root.localStorage.getItem(LS_PREFIX + k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(LS_PREFIX + k, v); } catch (e) { /* storage blocked / 存储被禁用 */ } }
  function lsDel(k) { try { root.localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* ignore / 忽略 */ } }

  // Errors carry a `code` so the UI can show them in the user's language (see i18n.js "err.*").
  // 错误带有 `code`，界面可据此显示用户语言的提示（见 i18n.js 中的 "err.*"）。
  function fail(code, message, vars) {
    const e = new Error(message);
    e.code = code;
    e.vars = vars;
    return e;
  }

  function uuid() {
    if (root.crypto.randomUUID) return root.crypto.randomUUID();
    const b = C.randomBytes(16);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }
  function emptyVault() { return { entries: [], settings: {} }; }

  // Last-writer-wins per entry id; settings from whichever side changed most recently.
  // 按条目 id“最后写入者胜出”；设置取最近修改的一方。
  function merge(a, b) {
    const byId = new Map();
    for (const e of a.entries || []) byId.set(e.id, e);
    for (const e of b.entries || []) {
      const cur = byId.get(e.id);
      if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(e.id, e);
    }
    const sa = a.settings || {}, sb = b.settings || {};
    return {
      entries: Array.from(byId.values()),
      settings: (sb.updatedAt || 0) > (sa.updatedAt || 0) ? sb : sa,
    };
  }

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  // Thin client for the sync server API (see server/server.js).
  // 同步服务器 API 的轻量客户端（见 server/server.js）。
  class Api {
    constructor(baseUrl) { this.base = String(baseUrl || '').replace(/\/+$/, ''); this.token = null; }
    async req(method, path, body) {
      let res;
      try {
        res = await fetch(this.base + path, {
          method,
          headers: Object.assign({ 'Content-Type': 'application/json' },
            this.token ? { Authorization: 'Bearer ' + this.token } : {}),
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw new ApiError(0, 'Cannot reach sync server');
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.error || ('HTTP ' + res.status));
      return data;
    }
    async register(username, authKey) { return this.req('POST', '/api/register', { username, authKey }); }
    async login(username, authKey) {
      const r = await this.req('POST', '/api/login', { username, authKey });
      this.token = r.token;
      return r;
    }
    getVault() { return this.req('GET', '/api/vault'); }
    putVault(baseVersion, blob) { return this.req('PUT', '/api/vault', { baseVersion, blob }); }
  }

  class Store {
    constructor() {
      this.username = null;
      this.keys = null;
      this.envelope = null;
      this.vaultKey = null;
      this.vault = null;
      this.api = null;
      this.version = 0;          // server version our local copy is based on / 本地副本所基于的服务器版本
      this.dirty = false;        // local changes not yet pushed / 尚未推送的本地更改
      this.listeners = new Set();
      this.status = 'local';     // local | synced | syncing | offline | error
      this.statusDetail = '';
      this.lastError = null;     // last sync error, for translated messages / 最近的同步错误，用于显示翻译后的提示
    }

    static lastProfile() {
      try { return JSON.parse(lsGet('profile') || 'null'); } catch (e) { return null; }
    }
    static hasLocalVault(username) { return !!lsGet('vault:' + C.normalizeUser(username)); }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { for (const fn of this.listeners) fn(this); }
    setStatus(s, detail) { this.status = s; this.statusDetail = detail || ''; this.emit(); }

    get isUnlocked() { return !!this.vault; }
    get entries() { return (this.vault ? this.vault.entries : []).filter((e) => !e.deleted); }

    // Unlock an existing vault, or create one when `create` is true.
    // serverUrl is optional: without it the vault is local-only on this device.
    // 解锁已有密码库；`create` 为 true 时创建新库。
    // serverUrl 可选：不填则密码库只保存在本设备。
    async unlock({ username, password, serverUrl, create }) {
      username = C.normalizeUser(username);
      if (!username || !password) throw fail('NEED_CREDS', 'Enter a username and master password');
      if (create && password.length < 10) throw fail('PW_SHORT', 'Use at least 10 characters for your master password');
      const keys = await C.deriveKeys(username, password);
      const api = serverUrl ? new Api(serverUrl) : null;
      const cached = lsGet('vault:' + username);
      const local = cached ? JSON.parse(cached) : null; // { version, envelope, dirty }
      if (create && local) throw fail('VAULT_EXISTS', 'A vault for "' + username + '" already exists on this device — unlock it instead', { user: username });

      if (api) {
        try {
          if (create) await api.register(username, keys.authKey);
          await api.login(username, keys.authKey);
        } catch (e) {
          // Offline is fine if we have a local copy; bad credentials are not.
          // 有本地副本时离线也能用；但凭据错误不行。
          if (e.status !== 0 || !local) throw e;
          this.lastError = e;
          this.setStatus('offline', e.message);
        }
      }

      let opened;
      if (local) {
        opened = await C.openEnvelope(keys, local.envelope);
        this.envelope = local.envelope;
        this.version = local.version || 0;
        this.dirty = !!local.dirty;
      } else if (api && api.token && !create) {
        const remote = await api.getVault();
        if (!remote.blob) throw fail('NO_REMOTE', 'No vault on server yet');
        this.envelope = JSON.parse(remote.blob);
        opened = await C.openEnvelope(keys, this.envelope);
        this.version = remote.version;
      } else if (create) {
        const made = await C.createEnvelope(keys, emptyVault());
        this.envelope = made.envelope;
        opened = { vault: emptyVault(), vaultKey: made.vaultKey };
        this.version = 0;
        this.dirty = true;
      } else {
        throw fail('NO_VAULT', 'No vault found for "' + username + '" on this device. Add a sync server or create a new vault.', { user: username });
      }

      this.username = username;
      this.keys = keys;
      this.api = api;
      this.vault = opened.vault;
      this.vaultKey = opened.vaultKey;
      lsSet('profile', JSON.stringify({ username, serverUrl: serverUrl || '' }));
      await this.persistLocal();
      if (!api) this.setStatus('local');
      if (api && api.token) await this.sync();
      this.emit();
    }

    lock() {
      this.keys = this.vault = this.vaultKey = this.envelope = null;
      if (this.api) this.api.token = null;
      this.emit();
    }

    // Re-encrypt and save the local copy (encrypted only). / 重新加密并保存本地副本（只保存密文）。
    async persistLocal() {
      this.envelope = await C.sealVault(this.envelope, this.vaultKey, this.vault);
      lsSet('vault:' + this.username, JSON.stringify({ version: this.version, envelope: this.envelope, dirty: this.dirty }));
    }

    async save() {
      this.dirty = true;
      await this.persistLocal();
      this.emit();
      if (this.api && this.api.token) this.sync();
    }

    // Pull → merge → push with optimistic versioning; retries if another device pushed first.
    // 拉取 → 合并 → 推送（乐观版本控制）；如果其他设备先推送了，就重试。
    async sync() {
      if (!this.api || !this.api.token || this._syncing) return;
      this._syncing = true;
      this.setStatus('syncing');
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const remote = await this.api.getVault();
          if (remote.version > this.version && remote.blob) {
            const theirs = await C.openEnvelope(this.keys, JSON.parse(remote.blob));
            this.vault = this.dirty ? merge(this.vault, theirs.vault) : theirs.vault;
            this.version = remote.version;
          }
          if (!this.dirty) break;
          this.envelope = await C.sealVault(this.envelope, this.vaultKey, this.vault);
          try {
            const r = await this.api.putVault(this.version, JSON.stringify(this.envelope));
            this.version = r.version;
            this.dirty = false;
            break;
          } catch (e) {
            // another device pushed first → pull, merge, retry / 其他设备先推送了 → 拉取、合并、重试
            if (e.status !== 409) throw e;
          }
        }
        await this.persistLocal();
        this.lastError = null;
        this.setStatus('synced', new Date().toLocaleTimeString());
      } catch (e) {
        if (e.status === 401) e.code = 'SESSION'; // token expired (12 h) / 会话令牌过期（12 小时）
        this.lastError = e;
        this.setStatus(e.status === 0 ? 'offline' : 'error', e.message);
      } finally {
        this._syncing = false;
      }
    }

    upsert(fields) {
      const now = Date.now();
      const existing = fields.id && this.vault.entries.find((e) => e.id === fields.id);
      if (existing) {
        Object.assign(existing, fields, { updatedAt: now });
        return this.save().then(() => existing);
      }
      const entry = Object.assign({ title: '', username: '', password: '', url: '', notes: '', tags: [], folder: '' },
        fields, { id: uuid(), createdAt: now, updatedAt: now });
      this.vault.entries.push(entry);
      return this.save().then(() => entry);
    }

    remove(id) {
      const e = this.vault.entries.find((x) => x.id === id);
      if (!e) return Promise.resolve();
      // Tombstone: wipe secrets, keep id so the deletion syncs.
      // 墓碑：清除所有机密内容，只保留 id，以便删除操作能同步。
      for (const k of Object.keys(e)) if (k !== 'id') delete e[k];
      Object.assign(e, { deleted: true, updatedAt: Date.now() });
      return this.save();
    }

    get settings() { return (this.vault && this.vault.settings) || {}; }
    setSettings(patch) {
      this.vault.settings = Object.assign({}, this.vault.settings, patch, { updatedAt: Date.now() });
      return this.save();
    }

    forgetDevice() { if (this.username) lsDel('vault:' + this.username); lsDel('profile'); }
  }

  root.PV = root.PV || {};
  root.PV.store = { Store, merge, uuid };
})(typeof window !== 'undefined' ? window : globalThis);
