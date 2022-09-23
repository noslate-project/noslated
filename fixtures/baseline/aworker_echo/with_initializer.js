'use strict';

let installed = false;
addEventListener('install', event => {
  event.waitUntil(
    new Promise(resolve => setTimeout(resolve, 100))
      .then(() => {
        installed = true;
      })
  );
});

addEventListener('fetch', event => {
  const body = event.request.body;
  event.respondWith(new Response(body, {
    headers: {
      'x-installed': installed,
    },
  }));
});
