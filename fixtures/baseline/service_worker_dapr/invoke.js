'use strict';
const dapr = aworker.Dapr['1.0'];

addEventListener('fetch', event => {
  event.respondWith(Promise.resolve()
    .then(async () => {
      const response = await dapr.invoke({
        app: 'hello-world',
        method: event.request.headers.get('DAPR_METHOD') ?? 'echo',
        body: 'foobar',
      });
      return response;
    }));
});
