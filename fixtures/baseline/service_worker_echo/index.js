'use strict';

addEventListener('fetch', event => {
  const body = event.request.body;
  event.respondWith(new Response(body));
});
