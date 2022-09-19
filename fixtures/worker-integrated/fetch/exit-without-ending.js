'use strict';

addEventListener('fetch', event => {
  event.respondWith((async () => {
    const resp = await fetch('http://localhost:23888/black-hole', { method: 'GET' });
    resp.status;
    /** do not wait for resp body */
    return new Response('ok');
  })());
});
