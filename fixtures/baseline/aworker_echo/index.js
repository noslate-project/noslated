'use strict';

addEventListener('fetch', event => {
  const body = event.request.body;
  event.respondWith(new Response(body, {
    headers: {
      'x-noslate-worker-id': aworker.env.NOSLATE_WORKER_ID
    }
  }));
});
