'use strict';

let initialized = false;

exports.initializer = async () => {
  await new Promise(resolve => setTimeout(resolve, 100));
  initialized = true;
};

exports.handler = (ctx, req, res) => {
  res.setHeader('x-initialized', initialized);
  req.pipe(res);
  req.on('error', e => {
    res.destroy(e);
  });
};
