'use strict';

exports.handler = (ctx, req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    res.end(JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers,
      baggage: req.baggage,
    }));
  });
};
