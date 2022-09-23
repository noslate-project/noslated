'use strict';

addEventListener('fetch', event => {
  event.respondWith(Promise.reject(new Error('foobar')));
});

addEventListener('unhandledrejection', event => {
  event.preventDefault();
  console.error(event.reason);
});
