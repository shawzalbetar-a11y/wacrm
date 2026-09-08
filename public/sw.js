// Service Worker for wacrm PWA & Push Notifications

const CACHE_NAME = 'wacrm-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Push notification event (triggered from Web Push server)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  const title = data.title || 'رسالة واتساب جديدة 💬';
  const options = {
    body: data.body || 'لديك رسالة جديدة في wacrm',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    vibrate: [200, 100, 200],
    tag: data.tag || 'whatsapp-message',
    renotify: true,
    data: {
      url: data.url || (data.conversationId ? `/inbox` : '/inbox'),
      conversationId: data.conversationId,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click event: focus or open inbox
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/inbox';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes('/inbox')) {
            return client.focus();
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
