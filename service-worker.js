/*
 * Simple service worker to enable offline caching of the PWA chat app.
 * This caches the core assets and uses a network‑first strategy for dynamic
 * requests. For more advanced caching strategies (e.g. chat messages),
 * consider integrating IndexedDB or background sync.
 */

const CACHE_NAME = 'pwa-chat-cache-v2';
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
  if (request.method !== 'GET') return;

  // Avoid caching Socket.io polling or WebSocket requests. Treating them like
  // static assets breaks the realtime connection and prevents chat messages
  // from being delivered when the service worker is active.
  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (isSameOrigin && url.pathname.startsWith('/socket.io/')) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        return networkResponse;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) {
          return cached;
        }

        if (request.mode === 'navigate') {
          const fallback = await caches.match('/index.html');
          if (fallback) {
            return fallback;
          }
        }

        throw error;
      }
    })()
  );
});
