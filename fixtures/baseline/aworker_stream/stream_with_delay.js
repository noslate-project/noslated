'use strict';

addEventListener('fetch', event => {
  event.respondWith(
    Promise.resolve().then(async () => {
      const time = await event.request.text();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue('foobar');
          setTimeout(() => {
            controller.enqueue('end');
            controller.close();
          }, parseInt(time, 10));
        },
      });

      return new Response(body, {
        status: 200,
      });
    })
  );
});
