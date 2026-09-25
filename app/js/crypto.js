// CloudVault crypto — zero-knowledge, WebCrypto only (no third-party code).
// CloudVault 加密模块 —— 零知识架构，只使用浏览器内置的 WebCrypto（不含任何第三方代码）。
//
//   master password ──PBKDF2-SHA256(600k)──▶ master key ──HKDF──┬─▶ encKey  (AES-256-GCM, never leaves device)
//                                                              └─▶ authKey (sent to server; server stores scrypt(authKey))
//   random vaultKey ──wrapped by encKey──▶ envelope.wrappedKey
//   vault JSON      ──AES-256-GCM(vaultKey)──▶ envelope.data
//
//   主密码 ──PBKDF2-SHA256（60 万次）──▶ 主密钥 ──HKDF──┬─▶ encKey（AES-256-GCM，永不离开设备）
//                                                    └─▶ authKey（发送给服务器；服务器只存 scrypt(authKey)）
//   随机 vaultKey ──用 encKey 包裹──▶ envelope.wrappedKey
//   密码库 JSON   ──AES-256-GCM(vaultKey)──▶ envelope.data
//
// The server (and anyone who steals its disk) only ever sees the envelope.
// 服务器（以及任何偷走其硬盘的人）只能看到加密信封。
(function (root) {
  'use strict';
  const subtle = root.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const DEFAULT_ITERATIONS = 600000; // OWASP 2023+ recommendation for PBKDF2-SHA256 / OWASP 2023 年起对 PBKDF2-SHA256 的推荐值
  const AAD = enc.encode('cloudvault-v1');

  function b64(bytes) {
    let s = '';
    const a = new Uint8Array(bytes);
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    const s = atob(str);
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function randomBytes(n) {
    return root.crypto.getRandomValues(new Uint8Array(n));
  }
  function normalizeUser(username) {
    return String(username || '').trim().toLowerCase();
  }

  // Derive the encryption key and the server auth key from username + master password.
  // The username (normalised) is the salt, so the same account gets the same keys on every device.
  // 由用户名 + 主密码派生加密密钥和服务器认证密钥。
  // 规范化后的用户名作为盐，因此同一账户在每台设备上得到相同的密钥。
  async function deriveKeys(username, password, iterations = DEFAULT_ITERATIONS) {
    const salt = new Uint8Array(await subtle.digest('SHA-256', enc.encode('cloudvault|' + normalizeUser(username))));
    const pwKey = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const masterBits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, pwKey, 256);
    const hkdf = await subtle.importKey('raw', masterBits, 'HKDF', false, ['deriveKey', 'deriveBits']);
    const empty = new Uint8Array(0);
    const encKey = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: empty, info: enc.encode('cloudvault-enc') },
      hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const authBits = await subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: empty, info: enc.encode('cloudvault-auth') }, hkdf, 256);
    return { encKey, authKey: b64(authBits), iterations };
  }

  // AES-256-GCM with a fresh random 12-byte IV; output is base64(iv || ciphertext+tag).
  // AES-256-GCM，每次使用新的 12 字节随机 IV；输出为 base64(iv || 密文+认证标签)。
  async function encryptBytes(key, bytes) {
    const iv = randomBytes(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, bytes));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return b64(out);
  }
  async function decryptBytes(key, payload) {
    const all = unb64(payload);
    return new Uint8Array(await subtle.decrypt(
      { name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: AAD }, key, all.subarray(12)));
  }
  async function importVaultKey(raw) {
    return subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Create a brand-new envelope for `vault` using a fresh random vault key.
  // 用新生成的随机密码库密钥，为 `vault` 创建一个全新的加密信封。
  async function createEnvelope(keys, vault) {
    const raw = randomBytes(32);
    const vaultKey = await importVaultKey(raw);
    const envelope = {
      v: 1,
      kdf: { alg: 'PBKDF2-SHA256', iterations: keys.iterations },
      wrappedKey: await encryptBytes(keys.encKey, raw),
      data: await encryptBytes(vaultKey, enc.encode(JSON.stringify(vault))),
    };
    raw.fill(0); // wipe raw key bytes from memory / 从内存中清除原始密钥字节
    return { envelope, vaultKey };
  }

  // Throws 'Wrong master password' (code WRONG_PW) if the key can't unwrap the envelope.
  // 如果密钥无法解开信封，抛出“主密码错误”（错误码 WRONG_PW）。
  async function openEnvelope(keys, envelope) {
    let raw;
    try {
      raw = await decryptBytes(keys.encKey, envelope.wrappedKey);
    } catch (e) {
      const err = new Error('Wrong master password');
      err.code = 'WRONG_PW';
      throw err;
    }
    const vaultKey = await importVaultKey(raw);
    raw.fill(0);
    const vault = JSON.parse(dec.decode(await decryptBytes(vaultKey, envelope.data)));
    return { vault, vaultKey };
  }

  // Re-encrypt the vault contents with the existing vault key. / 用现有的密码库密钥重新加密密码库内容。
  async function sealVault(envelope, vaultKey, vault) {
    return Object.assign({}, envelope, { data: await encryptBytes(vaultKey, enc.encode(JSON.stringify(vault))) });
  }

  // ---------- password generation & strength (local only — never via AI) ----------
  // ---------- 密码生成与强度评估（只在本地进行——绝不经过 AI） ----------
  // Look-alike characters (l, 1, I, O, 0) are left out so passwords are easy to read and type.
  // 去掉了容易混淆的字符（l、1、I、O、0），方便阅读和输入。
  const SETS = {
    lower: 'abcdefghijkmnopqrstuvwxyz',
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    digits: '23456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.?/',
  };
  function randomInt(max) {
    // Rejection sampling: uniform in [0, max) with no modulo bias.
    // 拒绝采样：在 [0, max) 内均匀分布，没有取模偏差。
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do { root.crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }
  function generatePassword(opts) {
    const o = Object.assign({ length: 20, lower: true, upper: true, digits: true, symbols: true }, opts);
    const sets = ['lower', 'upper', 'digits', 'symbols'].filter((k) => o[k]).map((k) => SETS[k]);
    if (!sets.length) sets.push(SETS.lower);
    const length = Math.max(sets.length, Math.min(128, o.length | 0));
    const pool = sets.join('');
    const chars = sets.map((s) => s[randomInt(s.length)]); // guarantee one of each chosen class / 保证每类所选字符至少出现一次
    while (chars.length < length) chars.push(pool[randomInt(pool.length)]);
    for (let i = chars.length - 1; i > 0; i--) { // Fisher–Yates shuffle / Fisher–Yates 洗牌
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
  // Rough entropy estimate; capped hard for common passwords and penalised for repeats.
  // Score 0–4 maps to i18n keys strength0…strength4.
  // 粗略的熵估算；常见密码会被强制压低分数，重复字符会被扣分。
  // 分数 0–4 对应 i18n 中的 strength0…strength4。
  const COMMON = ['password', '123456', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'abc123'];
  function strength(pw) {
    pw = pw || '';
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    let bits = pw.length ? pw.length * Math.log2(Math.max(pool, 1)) : 0;
    const lower = pw.toLowerCase();
    if (COMMON.some((c) => lower.includes(c))) bits = Math.min(bits, 20);
    if (/(.)\1{2,}/.test(pw)) bits *= 0.8;
    const score = bits < 28 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    return { bits: Math.round(bits), score, label: ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'][score] };
  }

  root.PV = root.PV || {};
  root.PV.crypto = {
    deriveKeys, createEnvelope, openEnvelope, sealVault, generatePassword, strength,
    b64, unb64, randomBytes, normalizeUser, DEFAULT_ITERATIONS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
