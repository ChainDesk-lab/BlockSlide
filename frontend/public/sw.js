// No-op service worker — satisfies Chrome's PWA installability requirement
// without caching anything. All requests fall through to the network.
// Do NOT add caching or offline logic here.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
// No fetch handler — every request goes to the network as normal.
