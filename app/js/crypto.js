// CloudVault crypto — zero-knowledge, WebCrypto only (no third-party code).
//
//   master password ──PBKDF2-SHA256(600k)──▶ master key ──HKDF──┬─▶ encKey  (AES-256-GCM, never leaves device)
//                                                              └─▶ authKey (sent to server; server stores scrypt(authKey))
//   random vaultKey ──wrapped by encKey──▶ envelope.wrappedKey
//   vault JSON      ──AES-256-GCM(vaultKey)──▶ envelope.data
//
// The server (and anyone who steals its disk) only ever sees the envelope.
(function (root) {
  'use strict';
  const subtle = root.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const DEFAULT_ITERATIONS = 600000; // OWASP 2023+ recommendation for PBKDF2-SHA256
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
  async function createEnvelope(keys, vault) {
    const raw = randomBytes(32);
    const vaultKey = await importVaultKey(raw);
    const envelope = {
      v: 1,
      kdf: { alg: 'PBKDF2-SHA256', iterations: keys.iterations },
      wrappedKey: await encryptBytes(keys.encKey, raw),
      data: await encryptBytes(vaultKey, enc.encode(JSON.stringify(vault))),
    };
    raw.fill(0);
    return { envelope, vaultKey };
  }

  // Throws 'Wrong master password' if the key can't unwrap the envelope.
  async function openEnvelope(keys, envelope) {
    let raw;
    try {
      raw = await decryptBytes(keys.encKey, envelope.wrappedKey);
    } catch (e) {
      throw new Error('Wrong master password');
    }
    const vaultKey = await importVaultKey(raw);
    raw.fill(0);
    const vault = JSON.parse(dec.decode(await decryptBytes(vaultKey, envelope.data)));
    return { vault, vaultKey };
  }

  async function sealVault(envelope, vaultKey, vault) {
    return Object.assign({}, envelope, { data: await encryptBytes(vaultKey, enc.encode(JSON.stringify(vault))) });
  }

  // ---------- password generation & strength (local only — never via AI) ----------
  const SETS = {
    lower: 'abcdefghijkmnopqrstuvwxyz',
    upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
    digits: '23456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.?/',
  };
  function randomInt(max) {
    // Rejection sampling: uniform in [0, max) with no modulo bias.
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
    const chars = sets.map((s) => s[randomInt(s.length)]); // guarantee one of each chosen class
    while (chars.length < length) chars.push(pool[randomInt(pool.length)]);
    for (let i = chars.length - 1; i > 0; i--) { // Fisher–Yates
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }
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
