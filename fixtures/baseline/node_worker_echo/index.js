'use strict';

exports.handler = (ctx, req, res) => {
  res.writeHead(200);
  req.pipe(res);
  req.on('error', e => {
    res.destroy(e);
  });
};
