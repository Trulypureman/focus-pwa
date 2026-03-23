const CACHE = 'focus-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap'
];

// Install: Cache static assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      // Cache static assets
      await cache.addAll(STATIC_ASSETS);
      
      // Try to cache CDN assets (may fail due to CORS)
      for (const url of CDN_ASSETS) {
        try {
          const response = await fetch(url, { mode: 'no-cors' });
          await cache.put(url, response);
        } catch (err) {
          console.log('Failed to cache:', url);
        }
      }
      
      return cache;
    })
  );
  self.skipWaiting();
});

// Activate: Clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: Cache-first strategy with network fallback
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // API requests: network only
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  
  e.respondWith(
    caches.match(request).then(cached => {
      // Return cached version if available
      if (cached) {
        // Revalidate in background for CDN assets
        if (CDN_ASSETS.includes(url.href)) {
          fetch(request).then(response => {
            if (response.ok) {
              caches.open(CACHE).then(cache => cache.put(request, response));
            }
          }).catch(() => {});
        }
        return cached;
      }
      
      // Otherwise fetch from network
      return fetch(request).then(response => {
        // Cache successful responses
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Fallback for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Background Sync for offline session logging
self.addEventListener('sync', e => {
  if (e.tag === 'sync-sessions') {
    e.waitUntil(syncSessions());
  }
});

async function syncSessions() {
  // This would sync sessions with a server if implemented
  console.log('Background sync triggered');
}

// Push notification support
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Focus Timer', {
      body: data.body || 'Timer notification',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'focus-timer',
      requireInteraction: data.requireInteraction || false,
      actions: data.actions || []
    })
  );
});

// Notification click handling
self.addEventListener('notificationclick', e => {
  e.notification.close();
  
  if (e.action === 'dismiss') return;
  
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      if (clientList.length > 0) {
        clientList[0].focus();
      } else {
        clients.openWindow('./');
      }
    })
  );
});

// Message handling from main thread
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
