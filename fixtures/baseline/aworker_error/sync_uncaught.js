'use strict';

addEventListener('fetch', () => {
  throw new Error('foobar');
});

addEventListener('error', event => {
  event.preventDefault();
  console.error(event.error);
});
