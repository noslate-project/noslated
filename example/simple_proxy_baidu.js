'use strict';

// 简易 baidu.com 代理

async function proxy(parsed) {
  const url = `https://baidu.com${parsed}`;
  const result = await fetch(url);
  return { result, text: await result.text() };
}

addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const parsed = `${url.pathname}${url.search}`;

  const p = new Promise(async resolve => {
    let result;
    try {
      result = await proxy(parsed);
    } catch (e) {
      resolve(new Response(e.stack, {
        status: 500,
      }));
      return;
    }

    resolve(new Response(result.text, {
      status: result.result.status,
    }));
  });

  console.log(`[${new Date()}] ${parsed}`);
  event.respondWith(p);
});

addEventListener('uncaughtException', err => {
  console.error(err);
});

addEventListener('unhandledrejection', err => {
  console.error(err.reason);
});
