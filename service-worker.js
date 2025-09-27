/*
 * Simple service worker to enable offline caching of the PWA chat app.
 * This caches the core assets and uses a network‑first strategy for dynamic
 * requests. For more advanced caching strategies (e.g. chat messages),
 * consider integrating IndexedDB or background sync.
 */

const CACHE_NAME = 'pwa-chat-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/socket.io/socket.io.js',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Bypass non‑GET requests
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        // Update cache
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, networkResponse.clone());
        });
        return networkResponse.clone();
      });
      return cached || fetchPromise;
    })
  );
});