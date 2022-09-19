'use strict';

addEventListener('fetch', event => {
  event.respondWith(new Response(`${Math.random()}`));
});
