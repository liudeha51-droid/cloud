'use strict';
// Crypto round-trips, wrong-password rejection, tamper detection, generator and AI redaction.
// 加解密往返、错误密码拒绝、篡改检测、密码生成器以及 AI 数据脱敏的测试。
const test = require('node:test');
const assert = require('node:assert/strict');
require('../app/js/crypto.js');
require('../app/js/ai.js');
const C = globalThis.PV.crypto;
const ITER = 1000; // fast for tests; the app uses 600k / 测试用少量迭代以加快速度；应用实际使用 60 万次

test('envelope round-trip', async () => {
  const keys = await C.deriveKeys('Alice', 'correct horse battery staple', ITER);
  const vault = { entries: [{ id: 'x', title: 'Mail', password: 's3cret!' }], settings: {} };
  const { envelope, vaultKey } = await C.createEnvelope(keys, vault);
  assert.ok(!JSON.stringify(envelope).includes('s3cret'), 'plaintext must not appear in envelope');
  const opened = await C.openEnvelope(keys, envelope);
  assert.deepEqual(opened.vault, vault);

  vault.entries[0].password = 'changed';
  const sealed = await C.sealVault(envelope, vaultKey, vault);
  assert.notEqual(sealed.data, envelope.data);
  assert.equal((await C.openEnvelope(keys, sealed)).vault.entries[0].password, 'changed');
});

test('wrong password is rejected', async () => {
  const good = await C.deriveKeys('alice', 'right password', ITER);
  const bad = await C.deriveKeys('alice', 'wrong password', ITER);
  const { envelope } = await C.createEnvelope(good, { entries: [] });
  await assert.rejects(C.openEnvelope(bad, envelope), (e) => e.code === 'WRONG_PW' && /Wrong master password/.test(e.message));
});

test('auth key differs from encryption material and per user', async () => {
  const a = await C.deriveKeys('alice', 'same', ITER);
  const b = await C.deriveKeys('bob', 'same', ITER);
  const a2 = await C.deriveKeys(' ALICE ', 'same', ITER); // usernames are normalised
  assert.notEqual(a.authKey, b.authKey);
  assert.equal(a.authKey, a2.authKey);
  assert.equal(Buffer.from(a.authKey, 'base64').length, 32);
});

test('tampered ciphertext fails authentication', async () => {
  const keys = await C.deriveKeys('alice', 'pw', ITER);
  const { envelope } = await C.createEnvelope(keys, { entries: [] });
  const raw = C.unb64(envelope.data);
  raw[raw.length - 1] ^= 1;
  await assert.rejects(C.openEnvelope(keys, Object.assign({}, envelope, { data: C.b64(raw) })));
});

test('password generator honours options and is uniform-ish', () => {
  const pw = C.generatePassword({ length: 32, symbols: false });
  assert.equal(pw.length, 32);
  assert.match(pw, /^[a-zA-Z0-9]+$/);
  assert.match(pw, /[a-z]/); assert.match(pw, /[A-Z]/); assert.match(pw, /[0-9]/);
  const digitsOnly = C.generatePassword({ length: 12, lower: false, upper: false, symbols: false });
  assert.match(digitsOnly, /^[2-9]{12}$/);
  const seen = new Set(Array.from({ length: 200 }, () => C.generatePassword({ length: 16 })));
  assert.equal(seen.size, 200);
});

test('strength estimator', () => {
  assert.equal(C.strength('password123').score, 0);
  assert.ok(C.strength(C.generatePassword({ length: 20 })).score >= 3);
});

test('AI redaction never leaks secrets', () => {
  const entries = [
    { id: '1', title: 'Bank', url: 'https://secure.bank.com/login?user=jdoe', username: 'jdoe@example.com',
      password: 'Hunter2-Very-Secret', notes: 'PIN is 4321', tags: ['finance'], folder: 'Finance', createdAt: Date.now() },
    { id: '2', title: 'Shop', url: 'shop.com', username: 'x', password: 'Hunter2-Very-Secret', createdAt: Date.now() },
  ];
  const red = globalThis.PV.ai.redact(entries);
  const json = JSON.stringify(red);
  for (const secret of ['Hunter2', 'jdoe', '4321', 'login?user']) assert.ok(!json.includes(secret), 'leaked ' + secret);
  assert.equal(red[0].domain, 'secure.bank.com');
  assert.equal(red[0].password.reusedBy, 1);
  assert.equal(red[0].password.length, 19);
});
