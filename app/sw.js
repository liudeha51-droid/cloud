// Offline shell for the PWA. Caches only the app's own static files — never API responses.
// PWA 的离线外壳。只缓存应用自身的静态文件——绝不缓存 API 响应。
const CACHE = 'cloudvault-v3'; // bump when the file list changes / 文件列表变化时递增版本号
const SHELL = ['./', 'index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest',
  'js/i18n.js', 'js/platform.js', 'js/crypto.js', 'js/fuzzy.js', 'js/store.js', 'js/ai.js', 'js/app.js', 'js/gamepad.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
// Delete caches from older versions. / 删除旧版本的缓存。
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  // Network first so updates land immediately; fall back to cache when offline.
  // 网络优先，更新能立即生效；离线时退回缓存。
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
