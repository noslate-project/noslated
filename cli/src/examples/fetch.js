'use strict';

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      const url = await event.request.text();
      // const url = 'https://registry.npmmirror.com'
      return fetch(url, { method: 'GET' });
    }));
});
