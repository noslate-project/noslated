'use strict';

addEventListener('fetch', event => {
  const traceId = event.request.headers.get('trace-id');
  aworker.sendBeacon('trace', { format: 'eagleeye' }, `service_worker_beacon|${traceId}\n`);

  event.respondWith(new Response('hello-world'));
});
