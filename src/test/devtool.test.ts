import assert from 'assert';
import cp from 'child_process';
import path from 'path';

import urllib from 'urllib';

import * as util from '#self/lib/util';
import { internetDescribe } from './util';

internetDescribe('devtool', () => {
  it('should simple proxy baidu', async () => {
    const child = cp.spawn(path.join(__dirname, '../bin/dev'), [ path.join(__dirname, '../example/simple_proxy_baidu.js') ], {
      env: process.env,
      stdio: [ 'ignore', 'pipe', 'inherit' ],
    });

    const { resolve, promise } = util.createDeferred<void>();
    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      process.stdout.write(chunk.toString());
      if (stdout.includes('Aworker.js devtool listened at 7001')) resolve();
    });

    try {
      await promise;

      let ret = await urllib.request('http://127.0.0.1:7001');
      let data = ret.data.toString();

      assert.strictEqual(ret.status, 200);
      assert(data.length > 1000);
      assert(data.includes('百度一下'));

      ret = await urllib.request('http://127.0.0.1:7001/dsaklfhoiksadjfliasufoijwlkfjsaodciusajdclkj');
      data = ret.data.toString();
      assert(data.includes('404'));
      assert.strictEqual(ret.status, 404);
    } finally {
      child.kill('SIGKILL');
    }
  });
});
