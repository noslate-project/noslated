'use strict';

exports.handler = (ctx, req, res) => {
  const traceId = req.headers['trace-id'];
  ctx.sendBeacon('trace', { format: 'eagleeye' }, `node_worker_beacon|${traceId}\n`);
  res.writeHead(200);
  res.end();
};
