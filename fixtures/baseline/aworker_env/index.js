'use strict';

function washEnv() {
  const env = JSON.parse(JSON.stringify(aworker.env));

  // macOS auto added __CF_USER_TEXT_ENCODING, we should delete manually to pass
  // the CI.
  delete env.__CF_USER_TEXT_ENCODING;

  return env;
}

addEventListener('fetch', event => {
  event.respondWith(new Response(JSON.stringify(washEnv())));
});
