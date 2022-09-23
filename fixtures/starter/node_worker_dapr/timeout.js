'use strict';

exports.handler = async (ctx, req, res) => {
  const dapr = ctx.Dapr['1.0'];
  try {
    const resp = await dapr.invoke({
      app: 'timeout',
      method: '-',
      body: '1000',
      timeout: 1,
    });
    res.end(JSON.stringify({ success: await resp.text() }));
  } catch (e) {
    res.end(JSON.stringify({ error: e.message }));
  }
};
