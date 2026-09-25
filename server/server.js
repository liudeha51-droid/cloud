#!/usr/bin/env node
// CloudVault sync server — zero dependencies (Node >= 20).
//
// Zero-knowledge: clients send an *authKey* derived from the master password (never the
// password itself) and an already-encrypted vault blob. The server stores scrypt(authKey)
// and the opaque blob; it cannot decrypt anything.
//
// CloudVault 同步服务器 —— 零依赖（Node >= 20）。
// 零知识：客户端发送由主密码派生出的 *authKey*（绝不发送密码本身）和已经加密好的密码库数据。
// 服务器只保存 scrypt(authKey) 和这份不透明的密文，无法解密任何内容。
//
//   POST /api/register {username, authKey}         → 201 {ok}
//   POST /api/login    {username, authKey}         → 200 {token}
//   GET  /api/vault                     (Bearer)   → 200 {version, blob}
//   PUT  /api/vault    {baseVersion, blob} (Bearer)→ 200 {version} | 409 on conflict / 冲突时返回 409
//   GET  /api/health                               → 200 {ok}
//   GET  /*  → serves ../app (the PWA) / 提供 ../app 网页应用（PWA）
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

const MAX_BODY = 10 * 1024 * 1024; // 10 MB encrypted vault is thousands of entries / 10 MB 的加密密码库足够容纳数千个条目
const TOKEN_TTL = 12 * 3600 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png',
};

function createServer(opts = {}) {
  const dataDir = path.resolve(opts.dataDir || process.env.CLOUDVAULT_DATA || path.join(__dirname, 'data'));
  const staticDir = path.resolve(opts.staticDir || path.join(__dirname, '..', 'app'));
  const allowRegistration = opts.allowRegistration ?? (process.env.ALLOW_REGISTRATION || 'true') !== 'false';
  const corsOrigin = opts.corsOrigin || process.env.CORS_ORIGIN || '*';
  fs.mkdirSync(path.join(dataDir, 'vaults'), { recursive: true });

  // Server secret for signing session tokens (persisted so restarts don't log everyone out).
  // 用于签名会话令牌的服务器密钥（持久保存，重启后用户不会被全部登出）。
  const secretFile = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  const secret = Buffer.from(process.env.CLOUDVAULT_SECRET || fs.readFileSync(secretFile, 'utf8').trim(), 'utf8');

  const usersFile = path.join(dataDir, 'users.json');
  let users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, 'utf8')) : {};

  // Serialise all writes so concurrent requests can't interleave.
  // 所有写操作串行执行，避免并发请求互相穿插。
  let chain = Promise.resolve();
  const serial = (fn) => (chain = chain.then(fn, fn));

  async function atomicWrite(file, content) {
    const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fsp.writeFile(tmp, content, { mode: 0o600 });
    await fsp.rename(tmp, file);
  }

  const userId = (u) => crypto.createHash('sha256').update('user:' + u).digest('hex');
  const vaultFile = (u) => path.join(dataDir, 'vaults', userId(u) + '.json');
  // Async scrypt runs on the libuv thread pool, so a burst of logins can't freeze the event loop.
  // 异步 scrypt 在 libuv 线程池中执行，大量登录请求不会卡住事件循环。
  const hashAuth = (authKey, salt) => scrypt(authKey, salt, 32, { N: 16384, r: 8, p: 1 });

  function signToken(username) {
    const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + TOKEN_TTL })).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return payload + '.' + sig;
  }
  function verifyToken(token) {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', secret).update(payload).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() && users[data.u] ? data.u : null;
  }

  // Fixed-window rate limiter. Expired windows are swept so the map can't grow without bound.
  // 固定窗口限流器。过期的窗口会被清理，避免 Map 无限增长。
  function limiter(max, windowMs) {
    const hits = new Map();
    const expired = (h, now) => now - h.first >= windowMs;
    return {
      blocked(key) {
        const h = hits.get(key);
        return !!h && h.count >= max && !expired(h, Date.now());
      },
      hit(key) {
        const now = Date.now();
        if (hits.size >= 10000) for (const [k, h] of hits) if (expired(h, now)) hits.delete(k);
        const h = hits.get(key);
        if (!h || expired(h, now)) hits.set(key, { count: 1, first: now });
        else h.count++;
      },
      reset(key) { hits.delete(key); },
    };
  }
  // Brute-force protection: max 10 failed logins per (ip, username) per 15 min.
  // 防暴力破解：每个（IP，用户名）组合 15 分钟内最多失败 10 次。
  const loginFailures = limiter(10, 15 * 60000);
  // Account-creation spam protection: max 20 registrations per IP per hour.
  // 防批量注册：每个 IP 每小时最多注册 20 个账户。
  const registrations = limiter(opts.registerLimit ?? 20, 3600 * 1000);

  function send(res, status, body, headers) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, headers));
    res.end(JSON.stringify(body));
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (e) { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }
  function validCreds(body) {
    const username = String(body.username || '').trim().toLowerCase();
    const authKey = String(body.authKey || '');
    if (!/^[\p{L}\p{N}._@+-]{1,128}$/u.test(username)) throw Object.assign(new Error('Invalid username'), { status: 400 });
    if (!/^[A-Za-z0-9+/=]{40,64}$/.test(authKey)) throw Object.assign(new Error('Invalid auth key'), { status: 400 });
    return { username, authKey };
  }

  async function api(req, res, url) {
    const ip = req.socket.remoteAddress || '';
    if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true });

    if (url.pathname === '/api/register' && req.method === 'POST') {
      if (!allowRegistration) return send(res, 403, { error: 'Registration is disabled on this server' });
      const { username, authKey } = validCreds(await readJson(req));
      if (registrations.blocked(ip)) return send(res, 429, { error: 'Too many new accounts, try again later' });
      const salt = crypto.randomBytes(16);
      const hash = (await hashAuth(authKey, salt)).toString('hex');
      return serial(async () => {
        if (users[username]) return send(res, 409, { error: 'Username already taken' });
        registrations.hit(ip);
        users[username] = { salt: salt.toString('hex'), hash, created: Date.now() };
        await atomicWrite(usersFile, JSON.stringify(users, null, 1));
        send(res, 201, { ok: true });
      });
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const { username, authKey } = validCreds(await readJson(req));
      const key = ip + '|' + username;
      if (loginFailures.blocked(key)) return send(res, 429, { error: 'Too many attempts, try again in 15 minutes' });
      const u = users[username];
      // Hash even for unknown users so response timing doesn't reveal which usernames exist.
      // 即使用户不存在也照样计算哈希，避免通过响应时间判断用户名是否存在。
      const salt = u ? Buffer.from(u.salt, 'hex') : crypto.randomBytes(16);
      const got = await hashAuth(authKey, salt);
      const ok = u && crypto.timingSafeEqual(got, Buffer.from(u.hash, 'hex'));
      if (!ok) { loginFailures.hit(key); return send(res, 401, { error: 'Wrong username or master password' }); }
      loginFailures.reset(key);
      return send(res, 200, { token: signToken(username) });
    }

    if (url.pathname === '/api/vault') {
      const user = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
      if (!user) return send(res, 401, { error: 'Session expired — unlock again' });
      const file = vaultFile(user);
      const load = async () => {
        try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
        catch (e) { return { version: 0, blob: null }; }
      };
      if (req.method === 'GET') {
        const v = await load();
        return send(res, 200, { version: v.version, blob: v.blob });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        if (typeof body.blob !== 'string' || !Number.isInteger(body.baseVersion)) return send(res, 400, { error: 'Expected {baseVersion, blob}' });
        return serial(async () => {
          const cur = await load();
          if (body.baseVersion !== cur.version) return send(res, 409, { error: 'Vault changed on another device', version: cur.version });
          const next = { version: cur.version + 1, blob: body.blob, updatedAt: Date.now() };
          await atomicWrite(file, JSON.stringify(next));
          send(res, 200, { version: next.version });
        });
      }
    }
    return send(res, 404, { error: 'Not found' });
  }

  async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    let rel;
    try { rel = decodeURIComponent(url.pathname); }
    catch (e) { return send(res, 400, { error: 'Bad request' }); } // malformed %-escape / 非法的百分号转义
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(staticDir, '.' + path.posix.normalize(rel));
    if (!file.startsWith(staticDir + path.sep)) return send(res, 403, { error: 'Forbidden' }); // path traversal guard / 防止路径穿越
    try {
      const data = await fsp.readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (e) {
      send(res, 404, { error: 'Not found' });
    }
  }

  return http.createServer(async (req, res) => {
    // Bearer-token auth (no cookies), so a wildcard CORS origin is safe and lets the
    // desktop/mobile apps (tauri://, http://tauri.localhost) talk to this server.
    // 使用 Bearer 令牌认证（不用 Cookie），因此允许任意来源的 CORS 是安全的，
    // 这样桌面/手机应用（tauri://、http://tauri.localhost）才能访问本服务器。
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else await serveStatic(req, res, url);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
      if (!e.status) console.error(e);
    }
  });
}

if (require.main === module) {
  const port = +(process.env.PORT || 8787);
  const host = process.env.HOST || '0.0.0.0';
  createServer().listen(port, host, () => {
    console.log(`CloudVault sync server on http://${host}:${port}  (put HTTPS in front of it for internet use)`);
  });
}

module.exports = { createServer };
