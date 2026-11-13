const CACHE_NAME = 'kurortnik-cache-v34_3';
const STATIC_RESOURCES = [
  '/',
  '/index.html',
  '/css/styles_new.css',
  '/js/app.js',
  '/js/api.js',
  '/js/cart.js',
  '/js/catalog.js',
  '/manifest.json',
  '/admin.html',
  '/css/admin_v4.css',
  '/js/admin_v4.js',
  '/js/chart.js',
  '/admin_manifest.json',
  '/assets/placeholder.svg',
  '/assets/icons/icon-72x72.png',
  '/assets/icons/icon-96x96.png',
  '/assets/icons/icon-128x128.png',
  '/assets/icons/icon-144x144.png',
  '/assets/icons/icon-152x152.png',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-384x384.png',
  '/assets/icons/icon-512x512.png',
  '/assets/icons/admin-icon-512x512.png',
  '/assets/icons/badge-monochrome.png'
];

// Install Event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching static files');
      return cache.addAll(STATIC_RESOURCES);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - handle requests using appropriate strategies
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass service worker for version.json and specific API endpoints
  if (url.pathname.includes('version.json') || 
      (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/products') && !url.pathname.startsWith('/api/categories'))) {
    return;
  }

  // We should NOT cache non-GET requests (e.g. POST, PUT, DELETE)
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Strategy for API Catalog / Products calls: Network-first with Cache fallback
  if (url.pathname.startsWith('/api/products') || url.pathname.startsWith('/api/categories')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and cache the successful response
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // If offline, return cached version
          return caches.match(event.request);
        })
    );
    return;
  }

  // Default Strategy: Cache-first for static resources, fallback to Network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Cache newly fetched static resources (e.g., product images from /uploads or external URLs)
        if (response.status === 200 && (url.pathname.includes('/uploads/') || url.pathname.includes('/static/'))) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});

// Push Event - handle background Web Push notifications
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push Notification Received', event);
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: 'Уведомление',
        body: event.data.text()
      };
    }
  }

  const title = data.title || 'Курортник';
  const options = {
    body: data.body || 'Статус заказа обновлен',
    icon: data.icon || '/assets/icons/icon-192x192.png',
    badge: '/assets/icons/badge-monochrome.png',
    data: data.data || { url: '/index.html' },
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification Click Event - open app or navigate to URL
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click Received', event);
  event.notification.close();

  const urlToOpen = (event.notification.data && event.notification.data.url) 
    ? event.notification.data.url 
    : '/index.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // If we already have a window open, focus it
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes('/index.html') && 'focus' in client) {
          // Send messages to the client to update page if needed
          if (client.url !== urlToOpen) {
            client.navigate(urlToOpen);
          }
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
