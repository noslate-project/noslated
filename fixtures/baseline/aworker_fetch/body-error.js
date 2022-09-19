'use strict';

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      const body = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.error(new Error('foobar'));
          }, 100);
        },
      });
      const future = fetch('http://httpbin.org/post', {
        method: 'POST',
        body,
      });
      let error;
      try {
        await future;
      } catch (e) {
        error = e;
      }
      return new Response(error.toString());
    }));
});
