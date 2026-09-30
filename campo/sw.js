// Service worker do app de campo: guarda o app no aparelho para funcionar sem internet.
// Ao alterar arquivos do app, aumente a versão abaixo.
const CACHE = 'esg-campo-v2';
const FIREBASE = 'https://www.gstatic.com/firebasejs/12.6.0/';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/sync.js', 'js/field.js', 'js/properties.js', 'js/media.js', 'js/signature.js',
  '../shared/app.css', '../shared/util.js', '../shared/scoring.js', '../shared/report.js', '../shared/csv.js',
  '../shared/firebase.js', '../shared/firebase-config.js',
  '../icons/icon.svg', '../icons/icon-192.png', '../icons/icon-512.png',
];
// SDK do Firebase (só é usado com internet, mas fica em cache para abrir mais rápido).
const SDK = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => FIREBASE + f);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    await cache.addAll(SDK).catch(() => {}); // não impede a instalação se o CDN falhar
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('esg-campo') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // SDK do Firebase: arquivos versionados, nunca mudam → cache primeiro.
  if (url.href.startsWith(FIREBASE)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return; // chamadas ao Firestore/Auth vão direto à rede

  // App: rede primeiro (com limite de tempo, pois o sinal no campo é instável); se falhar, usa o cache.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await Promise.race([
        fetch(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return cache.match('index.html');
      return Response.error();
    }
  })());
});
