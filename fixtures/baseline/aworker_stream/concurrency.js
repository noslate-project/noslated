'use strict';

let activeReqCount = 0;
addEventListener('fetch', event => {
  activeReqCount++;
  console.log('activeReqCount', activeReqCount);
  if (activeReqCount > 1) {
    event.respondWith(
      new Response('', {
        status: 400,
      })
    );
    return;
  }

  const body = new ReadableStream({
    start(controller) {
      setTimeout(() => {
        controller.enqueue('foobar');
        controller.close();
        activeReqCount--;
      }, 1000);
    },
  });
  event.respondWith(
    new Response(body, {
      status: 200,
    })
  );
});
