'use strict';

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      const url = await event.request.text();
      return fetch(url, { method: 'GET' });
    }));
});
