'use strict';

let storage;
addEventListener('install', event => {
  event.waitUntil(Promise.resolve()
    .then(async () => {
      storage = await aworker.kvStorages.open('test');
    }));
});

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      const value = await storage.get('test-key');
      return new Response(value);
    }));
});
