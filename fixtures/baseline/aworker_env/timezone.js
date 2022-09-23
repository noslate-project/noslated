'use strict';

addEventListener('fetch', event => {
  event.respondWith(new Response(JSON.stringify({
    TZ: aworker.env.TZ,
    exemplar: new Date('2022-02-24 14:28:38').toISOString(),
  })));
});
