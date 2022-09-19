'use strict';

exports.handler = async (ctx, req, res) => {
  const dapr = ctx.Dapr['1.0'];
  const resp = await dapr.binding({
    name: 'key-value',
    metadata: {
      foo: {
        bar: 'bar',
      },
    },
    operation: req.headers.DAPR_OPERATION ?? 'get',
    body: 'foobar',
  });
  res.end(JSON.stringify({
    status: resp.status,
    text: await resp.text(),
  }));
};
