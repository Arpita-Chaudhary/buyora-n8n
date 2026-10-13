// Buyora Customer PWA - Service Worker v3
const CACHE_NAME = 'buyora-shell-v3';
const OFFLINE_URL = '/offline.html';

// Only cache truly static assets that are guaranteed to exist
const ASSETS_TO_CACHE = [
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Routes that belong to Admin / Rider / Backend – SW will completely bypass these
const BYPASS_PREFIXES = ['/dashboard', '/admin', '/rider', '/api', '/auth', '/stripe', '/simulator'];

function shouldBypass(request) {
  try {
    const url = new URL(request.url);
    if (BYPASS_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
      return true;
    }
    // Also bypass any sub-request initiated by Admin or Rider pages
    if (request.referrer) {
      const refUrl = new URL(request.referrer);
      if (BYPASS_PREFIXES.some((prefix) => refUrl.pathname.startsWith(prefix))) {
        return true;
      }
    }
  } catch (e) {}
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache each asset individually so one failure does NOT break the whole install
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] Failed to cache asset:', asset, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((name) => (name !== CACHE_NAME ? caches.delete(name) : null)))
    )
  );
  // Intentionally do NOT call self.clients.claim() to prevent hijacking Admin/Rider tabs
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Bypass all non-GET requests
  if (request.method !== 'GET') return;

  // Bypass Admin, Rider, API, Auth, Stripe, and WebSocket requests
  if (shouldBypass(request)) return;
  if (request.url.startsWith('ws:') || request.url.startsWith('wss:')) return;

  // Navigation requests: network-first, fallback to offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || new Response('Offline', { status: 503 }))
      )
    );
    return;
  }

  // Static assets: cache-first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((networkResponse) => {
        if (
          networkResponse.ok &&
          networkResponse.type === 'basic' &&
          !shouldBypass(request)
        ) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      }).catch(() => caches.match(OFFLINE_URL));
    })
  );
});
