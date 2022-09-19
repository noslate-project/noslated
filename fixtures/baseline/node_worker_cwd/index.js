'use strict';

exports.handler = (ctx, req, res) => {
  res.writeHead(200);
  res.end(process.cwd());
  req.on('error', e => {
    res.destroy(e);
  });
};
