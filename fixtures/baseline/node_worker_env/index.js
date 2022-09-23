'use strict';

function washEnv() {
  const env = JSON.parse(JSON.stringify(process.env));

  // macOS auto added __CF_USER_TEXT_ENCODING, we should delete manually to pass
  // the CI.
  delete env.__CF_USER_TEXT_ENCODING;

  return env;
}

exports.handler = (ctx, req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify(washEnv()));
  req.on('error', e => {
    res.destroy(e);
  });
};
