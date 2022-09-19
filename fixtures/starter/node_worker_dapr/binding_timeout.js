'use strict';

exports.handler = async (ctx, req, res) => {
  const dapr = ctx.Dapr['1.0'];
  try {
    const resp = await dapr.binding({
      name: 'timeout',
      body: '2000',
      metadata: {},
      timeout: 1,
    });
    res.end(JSON.stringify({
      status: resp.status,
      data: await resp.text(),
    }));
  } catch (e) {
    res.end(e.message);
  }
};
