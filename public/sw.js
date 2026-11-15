// Service worker: permite instalar o app e abre a tela inicial mesmo com internet ruim
const CACHE = 'watchparty-v4';
const SHELL = ['/', '/style.css', '/app.js', '/icon.svg', '/icon-192.png', '/manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/socket.io/')) return;
  // rede primeiro (sempre a versão mais nova), cache se estiver offline
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(u.pathname.startsWith('/r/') ? '/' : e.request, c)); } return r; })
    .catch(() => caches.match(u.pathname.startsWith('/r/') ? '/' : e.request)));
});
