'use strict';

let config = 'before-serialize';

addEventListener('serialize', event => {
  config = 'serialized';
  event.waitUntil(Promise.reject(new Error('serialize failure')));
});

addEventListener('deserialize', () => {
  config = 'deserialized';
});

addEventListener('fetch', event => {
  event.respondWith(new Response(`${config}`));
});
