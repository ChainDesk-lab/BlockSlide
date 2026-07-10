// Kill-switch service worker — replaces the no-op PWA service worker.
// On install it takes over immediately. On activate it wipes all caches,
// unregisters itself, and reloads every open tab so users get fresh JS.
// After this runs, no service worker remains registered for this origin.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Wipe every cache bucket this origin owns.
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));

      // Unregister this service worker so it does not linger.
      await self.registration.unregister();

      // Reload every open window/tab on this origin so the browser
      // re-fetches fresh JS without any service worker in the way.
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        client.navigate(client.url);
      }
    })()
  );
});
