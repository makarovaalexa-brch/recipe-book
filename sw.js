// Caches the app shell so recipes open even with poor kitchen wifi.
// Data is cached separately by app.js in localStorage.
const CACHE = 'recipe-book-v29';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'mock.js', 'classics.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first (so updates arrive), cache as fallback. no-cache = always ask GitHub if the file changed,
  // instead of trusting the browser's 10-minute copy.
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
