/* 知识星图 Service Worker：网络优先 + 缓存兜底，保证断网时仍可打开与学习 */
const CACHE = 'ksm-shell-v1';
const FALLBACK = './index.html';
const SHELL = ['./index.html', './manifest.json', './css/style.css', './assets/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE)
            .then(cache => cache.put(request, copy))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then(hit => {
        if (hit) return hit;
        if (request.mode === 'navigate') {
          return caches.match(FALLBACK).then(fallback => fallback || Response.error());
        }
        return Response.error();
      }))
  );
});
