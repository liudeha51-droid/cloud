'use strict';
// End-to-end: real sync server + two independent "devices" (separate localStorage) editing
// the same vault concurrently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/server.js');

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
// Each device gets its own storage; the store module reads globalThis.localStorage lazily.
let current = new MemStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => current });

require('../app/js/crypto.js');
require('../app/js/store.js');
const { Store, merge } = globalThis.PV.store;

const idle = async (s) => { while (s._syncing) await new Promise((r) => setTimeout(r, 10)); };

test('merge is last-writer-wins per entry and keeps tombstones', () => {
  const a = { entries: [{ id: '1', title: 'A-old', updatedAt: 1 }, { id: '2', title: 'only-a', updatedAt: 5 }], settings: {} };
  const b = { entries: [{ id: '1', title: 'B-new', updatedAt: 2 }, { id: '3', deleted: true, updatedAt: 9 }], settings: { updatedAt: 3, x: 1 } };
  const m = merge(a, b);
  const byId = Object.fromEntries(m.entries.map((e) => [e.id, e]));
  assert.equal(byId['1'].title, 'B-new');
  assert.equal(byId['2'].title, 'only-a');
  assert.equal(byId['3'].deleted, true);
  assert.equal(m.settings.x, 1);
});

test('two devices sync through the zero-knowledge server', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudvault-'));
  const server = createServer({ dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const devA = new MemStorage(), devB = new MemStorage();
  const creds = { username: 'alice', password: 'correct horse battery', serverUrl: url };

  // Device A creates the vault and adds an item.
  current = devA;
  const A = new Store();
  await A.unlock(Object.assign({ create: true }, creds));
  await A.upsert({ title: 'Gmail', username: 'alice@gmail.com', password: 'TopSecret-123' });
  await idle(A);
  assert.equal(A.status, 'synced');

  // The server must never see plaintext.
  const onDisk = fs.readdirSync(path.join(dataDir, 'vaults')).map((f) => fs.readFileSync(path.join(dataDir, 'vaults', f), 'utf8')).join();
  assert.ok(!onDisk.includes('TopSecret') && !onDisk.includes('Gmail'));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8').includes('correct horse'));

  // Device B signs in fresh and sees the item.
  current = devB;
  const B = new Store();
  await B.unlock(creds);
  await idle(B);
  assert.deepEqual(B.entries.map((e) => e.title), ['Gmail']);

  // Wrong password is rejected by the server.
  current = new MemStorage();
  await assert.rejects(new Store().unlock(Object.assign({}, creds, { password: 'nope nope nope' })), /Wrong username or master password/);

  // Concurrent edits: A adds Netflix, B (not yet aware) adds GitHub → B's push conflicts (409) and merges.
  current = devA;
  await A.upsert({ title: 'Netflix', password: 'n' });
  await idle(A);
  current = devB;
  B.api.getVault = (orig => async () => { B.api.getVault = orig; return { version: 0, blob: null }; })(B.api.getVault.bind(B.api)); // simulate stale view once
  await B.upsert({ title: 'GitHub', password: 'g' });
  await idle(B);
  assert.equal(B.status, 'synced');
  assert.deepEqual(B.entries.map((e) => e.title).sort(), ['GitHub', 'Gmail', 'Netflix']);

  // A pulls and converges; deletion propagates.
  current = devA;
  await A.sync();
  assert.deepEqual(A.entries.map((e) => e.title).sort(), ['GitHub', 'Gmail', 'Netflix']);
  await A.remove(A.entries.find((e) => e.title === 'Netflix').id);
  await idle(A);
  current = devB;
  await B.sync();
  assert.deepEqual(B.entries.map((e) => e.title).sort(), ['GitHub', 'Gmail']);

  // Offline unlock works from the local encrypted copy.
  server.close();
  server.closeAllConnections(); // drop keep-alive sockets so the server is truly unreachable
  current = devB;
  const B2 = new Store();
  await B2.unlock(creds);
  assert.equal(B2.status, 'offline');
  assert.equal(B2.entries.length, 2);
});

test('server rejects bad input and duplicate users', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudvault-'));
  const server = createServer({ dataDir });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  t.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const authKey = Buffer.alloc(32, 7).toString('base64');

  assert.equal((await post('/api/register', { username: 'bob', authKey })).status, 201);
  assert.equal((await post('/api/register', { username: 'bob', authKey })).status, 409);
  assert.equal((await post('/api/register', { username: 'x', authKey: 'short' })).status, 400);
  assert.equal((await fetch(url + '/api/vault')).status, 401);
  assert.equal((await fetch(url + '/api/vault', { headers: { authorization: 'Bearer forged.token' } })).status, 401);
  for (const evil of ['/..%2f..%2fserver/server.js', '/..%5c..%5cserver%5cserver.js', '/%2e%2e/server/server.js']) {
    const r = await fetch(url + evil);
    assert.ok([403, 404].includes(r.status), evil + ' → ' + r.status); // never serves files outside app/
  }
  assert.equal((await fetch(url + '/')).status, 200); // serves the PWA

  const { token } = await (await post('/api/login', { username: 'bob', authKey })).json();
  const put = (baseVersion) => fetch(url + '/api/vault', { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ baseVersion, blob: '{}' }) });
  assert.equal((await put(0)).status, 200);
  assert.equal((await put(0)).status, 409); // stale base version

  for (let i = 0; i < 10; i++) await post('/api/login', { username: 'bob', authKey: Buffer.alloc(32, 1).toString('base64') });
  assert.equal((await post('/api/login', { username: 'bob', authKey })).status, 429); // rate limited
});
