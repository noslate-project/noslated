'use strict';

addEventListener('fetch', event => {
  const { body, headers } = event.request;
  const response = new Response(body, {
    headers,
  });
  event.respondWith(response);
});
