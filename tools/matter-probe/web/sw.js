const CACHE = 'lightsage-shell-v10' + (self.LIGHTSAGE_BUILD ? `-${self.LIGHTSAGE_BUILD}` : '');
const FILES = ['/', '/app.js', '/bulb-photos.js', '/bulb-h6013.png', '/bulb-h6006.png', '/bulb-h6159.png', '/scene-controls.js', '/schedule-controls.js', '/color-wheel.js', '/gradient-controls.js', '/adjustment-queue.js', '/music-controls.js', '/audio-level.js', '/style.css', '/manifest.webmanifest?v=sage-20260920', '/logo.png?v=transparent-1', '/app-icon.png?v=sage-20260920', '/app-icon.ico?v=sage-20260920'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(FILES);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all((await caches.keys()).filter(key => key.startsWith('lightsage-shell-') && key !== CACHE).map(key => caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Desktop development reloads read straight from the service. The installed
  // phone app needs its complete shell before any network request can finish.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;
  const file = FILES.find(file => new URL(file, location.origin).pathname === url.pathname);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !file) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Use the canonical URL so query strings do not defeat offline lookup.
    return await cache.match(file) ?? fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'offline-status' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = (await Promise.all(FILES.map(file => cache.match(file)))).every(Boolean);
    event.ports[0].postMessage({ complete, version: CACHE });
  })());
});
