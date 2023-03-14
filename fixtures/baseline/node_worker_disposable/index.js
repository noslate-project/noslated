'use strict';

process.on('SIGTERM', () => {
  // Never settles.
  setTimeout(() => {}, 10_000_000);
});
exports.handler = (ctx, req, res) => {
  res.writeHead(200);
  res.end('hello-world');
};
