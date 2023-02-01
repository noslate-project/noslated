'use strict';

async function onFetch(request) {
  const sizeStr = await request.text();
  const size = parseInt(sizeStr, 10);

  const val = new Uint8Array(size);
  val.fill(49);

  return new Response(val, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'x-response-size': sizeStr,
      'x-noslate-worker-id': aworker.env.NOSLATE_WORKER_ID
    },
  }); 
}

addEventListener('fetch', event => {
  event.respondWith(onFetch(event.request));
});