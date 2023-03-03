'use strict';

addEventListener('install', event => {
  event.waitUntil(new Promise(() => {
    /** never settles */
  }));
});
