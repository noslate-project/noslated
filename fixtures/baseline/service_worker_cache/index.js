'use strict';

let cache;
addEventListener('install', event => {
  event.waitUntil(Promise.resolve()
    .then(async () => {
      cache = await caches.open('v1');
      cache.put('http://example.com', new Response('foobar', { status: 200 }));
    }));
});

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      return cache.match('http://example.com');
    }));
});
