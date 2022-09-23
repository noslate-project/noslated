'use strict';

exports.handler = (ctx, req, res) => {
  const headers = req.headers;
  res.writeHead(200, headers);
  req.pipe(res);
};
