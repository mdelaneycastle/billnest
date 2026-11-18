const scope = self.registration.scope;
const cachePrefix = 'outgoings-shell:' + scope + ':';
const cacheName = cachePrefix + 'v2';
const shell = [
  'index.html', 'styles.css', 'app.js', 'model.js', 'storage.js', 'push.js', 'push-config.js',
  'manifest.webmanifest', 'olly.webp', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];
const appUrl = new URL('./', scope).href;
const index = new URL('index.html', scope).href;
const known = new Set(shell.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(shell.map(path => new Request(new URL(path, scope), { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = request.url;
  if (request.mode === 'navigate' && (url.split('?')[0] === appUrl || url.split('?')[0] === index)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(index)).then(entry => entry || fetch(request)));
  } else if (known.has(url)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(request)).then(entry => entry || fetch(request)));
  }
});

self.addEventListener('push', event => {
  let test = false;
  try { test = event.data?.json().test === true; } catch { /* Use the generic reminder. */ }
  event.waitUntil(self.registration.showNotification('Olly’s Outgoings', {
    body: test ? 'Your phone can receive Outgoings alerts.' : 'You have a bill or renewal coming up. Open Upcoming to check.',
    icon: new URL('icons/icon-192.png', scope).href,
    tag: test ? 'outgoings-test' : 'outgoings-reminder',
    data: { test }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = new URL(event.notification.data?.test ? '#settings' : '#dates', scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(scope));
    if (existing) {
      try {
        const navigated = await existing.navigate(destination);
        if (navigated) return navigated.focus();
      } catch { /* Open a fresh app window. */ }
    }
    return self.clients.openWindow(destination);
  })());
});
