'use strict';

exports.handler = (ctx, req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify(process.execArgv));
  req.on('error', e => {
    res.destroy(e);
  });
};
