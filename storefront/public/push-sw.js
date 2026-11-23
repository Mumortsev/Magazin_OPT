/* Web Push only. Scoped to administrative pages. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { return; }
  if (!Number.isSafeInteger(message?.id) || message.id < 1) return;
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    tag: 'kurortnik-order-' + message.id,
    data: {id: message.id},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.id;
  if (!Number.isSafeInteger(id) || id < 1) return;
  const url = new URL('/admin/orders/' + id, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(async windows => {
    const existing = windows.find(client => client.url === url);
    return existing ? existing.focus() : self.clients.openWindow(url);
  }));
});
