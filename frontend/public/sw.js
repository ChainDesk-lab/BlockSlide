/**
 * DISABLED: Service worker removed to prevent stale cache issues during development.
 *
 * The SW was caching HTML on first load, causing users to see old sign-in UI
 * until a hard refresh. With this disabled, all requests go directly to the
 * Next.js dev server which serves fresh content.
 *
 * For production PWA support, re-enable with proper cache-busting strategy.
 */

// Unregister this service worker and delete all caches on every update
self.addEventListener('install', (event) => {
  console.log('[SW] Service worker disabled - skipping install');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Service worker disabled - unregistering and clearing all caches');
  event.waitUntil(
    (async () => {
      // Delete ALL caches to reset to clean state
      const cacheNames = await caches.keys();
      console.log(`[SW] Deleting ${cacheNames.length} old caches`);
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // Claim all clients and prompt reload
      await clients.claim();
      const allClients = await clients.matchAll({ type: 'window' });
      allClients.forEach((client) => {
        client.navigate(client.url);
      });
    })()
  );
});

// NO FETCH HANDLER — All requests bypass this SW and go directly to network
// This ensures fresh content is always served during development
