// Panopticon's service worker, only for alerts (see src/server/alerts.server.ts). It caches
// nothing, so the app always loads fresh from the server.
//
// Alerts arrive in Declarative Web Push's format ({ web_push: 8030, notification: {...} }): Safari
// (iOS 18.4 and later) can show those by itself; this shows them on other browsers, and opens the
// asset when one is tapped.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let notification = { title: 'Panopticon', body: '', navigate: '/' }
  try {
    notification = { ...notification, ...event.data.json().notification }
  } catch {
    // Not JSON: show the default.
  }
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      icon: '/icon-192.png',
      data: { url: notification.navigate },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    (async () => {
      // Panopticon already open: show the asset there.
      for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
        if ('navigate' in client) {
          await client.focus()
          return client.navigate(url)
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
