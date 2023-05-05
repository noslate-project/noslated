'use strict';
const dapr = aworker.Dapr['1.0'];

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      const operation = event.request.headers.get('DAPR_OPERATION');

      const response = await dapr.binding({
        name: 'key-value',
        metadata: {
          foo: JSON.stringify({
            bar: 'bar',
          }),
        },
        operation: event.request.headers.get('DAPR_OPERATION') ?? 'get',
        body: 'foobar',
      });

      if (operation === 'response-metadata') {
        return new Response(response.body, {
          headers: {
            'x-response-data-type': response.metadata.dataType
          }
        });
      }

      return response;
    }));
});
