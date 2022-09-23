'use strict';

addEventListener('fetch', event => {
  event.respondWith(
    Promise.resolve()
      .then(async () => {
        const time = await event.request.text();

        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(new Response(time));
          }, parseInt(time, 10));
        });
      })
  );
});
