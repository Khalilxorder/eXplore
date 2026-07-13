/* eXPLORE web service worker.
 * Keep the worker passive so cached app state can render without forcing a reload.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if ('caches' in self) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('explore-'))
          .map((cacheName) => caches.delete(cacheName))
      );
    }

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', () => {
  // No-op: the web build should hit the network directly.
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  const data = payload.data || payload;
  const webUrl = data.url || '';
  const targetUrl = webUrl.startsWith('/') || /^https?:\/\//i.test(webUrl)
    ? webUrl
    : '/?screen=priority-radar';
  event.waitUntil(
    self.registration.showNotification(payload.title || 'eXplore radar', {
      body: payload.body || 'A new priority update is ready.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: {
        ...data,
        url: targetUrl,
      },
      tag: data.alertId || 'priority-radar',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/?screen=priority-radar';

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          await client.navigate(targetUrl);
        }
        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
