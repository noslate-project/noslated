'use strict';

addEventListener('fetch', event => {
  const { url, method, headers } = event.request;
  event.respondWith(new Response(JSON.stringify({
    url,
    method,
    headers: Array.from(headers.entries()),
  })));
});
