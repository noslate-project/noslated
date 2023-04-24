'use strict';

addEventListener('fetch', event => {
  aworker.inspector.callAndPauseOnFirstStatement(handler);

  function handler() {
    const body = event.request.body;
    event.respondWith(
      new Response(body, {
        headers: {
          'x-noslate-worker-id': aworker.env.NOSLATE_WORKER_ID,
        },
      })
    );
  }
});
