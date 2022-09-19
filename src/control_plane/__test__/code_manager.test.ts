import { promises as fs } from 'fs';
import { CodeManager } from '#self/control_plane/code_manager';
import { testName } from '#self/test/common';
import * as testUtil from '#self/test/util';
import path from 'path';
import assert from 'assert';
import sinon from 'sinon';

describe(testName(__filename), () => {
  describe('ensure', () => {
    before(async () => {
      await testUtil.startResourceServer();
    });

    after(() => {
      testUtil.stopResourceServer();
    });

    afterEach(() => {
      sinon.restore();
      testUtil.unlinkTmpDir();
    });

    it('should generate integrity sigil', async () => {
      const codeManager = new CodeManager(testUtil.TMP_DIR());
      const bundlePath = await codeManager.ensure('test', 'http://127.0.0.1:55331/aworker-echo.zip', 'aaa');
      const stat = await fs.stat(path.join(bundlePath, '.integrity'));
      assert(stat.isFile());
    });

    it('should invalidate bundle if integrity sigil not presents', async () => {
      let codeManager = new CodeManager(testUtil.TMP_DIR());
      const spy = sinon.spy(codeManager, 'ensureFromHTTP');

      const bundlePath = await codeManager.ensure('test', 'http://127.0.0.1:55331/aworker-echo.zip', 'aaa');
      await fs.rm(bundlePath, { recursive: true });

      // simulates process restart
      codeManager = new CodeManager(testUtil.TMP_DIR());
      const bundlePath2 = await codeManager.ensure('test', 'http://127.0.0.1:55331/aworker-echo.zip', 'aaa');
      assert.strictEqual(bundlePath, bundlePath2);
      const stat = await fs.stat(path.join(bundlePath2, '.integrity'));
      assert(stat.isFile());

      assert.strictEqual(spy.calledOnce, true);
    });
  });
});
