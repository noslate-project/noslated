'use strict';

let config = 'before-serialize';

addEventListener('serialize', () => {
  config = 'serialized';
});

addEventListener('deserialize', () => {
  config = 'deserialized';
});

addEventListener('fetch', event => {
  event.respondWith(new Response(`${config}`));
});
