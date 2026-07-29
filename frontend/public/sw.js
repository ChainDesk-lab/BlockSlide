/**
 * Service Worker with aggressive update strategy.
 *
 * UPDATE STRATEGY:
 * - Cache names are versioned with build timestamp to invalidate on every deploy
 * - skipWaiting() forces new SW to activate even if old one is controlling clients
 * - clients.claim() immediately takes control of all pages
 * - Old caches are deleted on activate to free storage
 * - Navigation requests use network-first (fetch HTML fresh on every deploy)
 * - Static assets (_next/static/*) use cache-first (hashed, safe to cache)
 * - Page reload triggered on SW activation to ensure users see new code
 *
 * CRITICAL: This file must be served with Cache-Control: no-cache
 * by Vercel/CDN so browsers check for updates on every load.
 */

// Injected at build time — new build = new timestamp = new cache name
const BUILD_TIMESTAMP = new Date().getTime();
const CACHE_NAME = `blockslide-v${BUILD_TIMESTAMP}`;

// Immediately skip waiting; forces new SW to take control
self.addEventListener('install', (event) => {
  console.log(`[SW] Install: ${CACHE_NAME}`);
  self.skipWaiting();
});

// Take control of all clients and clean up old caches
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activate: claiming clients and cleaning old caches`);
  event.waitUntil(
    (async () => {
      // Take control immediately
      await clients.claim();

      // Delete all old caches from previous builds
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('blockslide-v') && name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );

      // Trigger page reload on all clients to ensure they load new code
      const allClients = await clients.matchAll({ type: 'window' });
      allClients.forEach((client) => {
        console.log(`[SW] Reloading client after activation`);
        client.navigate(client.url);
      });
    })()
  );
});

// Fetch handler: network-first for HTML, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Navigation requests (HTML documents) — network-first
  // Always fetch fresh on new deploy so users get updates immediately
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request).then((cached) => {
            return cached || new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  // Static assets (_next/static/*) — cache-first
  // These have hashes in their URLs, safe to cache aggressively
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          return cached;
        }
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else (API calls, images, fonts) — network-first with fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type !== 'error') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
