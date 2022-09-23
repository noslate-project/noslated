'use strict';

exports.handler = async (ctx, req, res) => {
  const dapr = ctx.Dapr['1.0'];
  const resp = await dapr.invoke({
    app: 'hello-world',
    method: req.headers.DAPR_METHOD ?? 'echo',
    body: 'foobar',
  });
  res.end(JSON.stringify({
    status: resp.status,
    text: await resp.text(),
  }));
};
