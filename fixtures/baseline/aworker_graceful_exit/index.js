'use strict';

addEventListener('fetch', event => {
  event.respondWith(new Response('hello-world'));
});

addEventListener('uninstall', event => {
  console.log('uninstalling');
  // Never settles.
  event.waitUntil(new Promise(() => {
    setTimeout(() => {}, 100_000_000);
  }));
});
