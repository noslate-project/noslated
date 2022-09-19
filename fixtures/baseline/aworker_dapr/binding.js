'use strict';
const dapr = aworker.Dapr['1.0'];

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      const response = await dapr.binding({
        name: 'key-value',
        metadata: {
          foo: {
            bar: 'bar',
          },
        },
        operation: event.request.headers.get('DAPR_OPERATION') ?? 'get',
        body: 'foobar',
      });
      return response;
    }));
});
