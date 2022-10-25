import assert from 'assert';
import cp from 'child_process';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import mm from 'mm';
import walk from 'walk';
import * as util from '#self/lib/util';
import * as testUtil from '#self/test/util';


describe('test/lib/util.test.js', () => {
  describe('tryQ', () => {
    it('should return number', () => {
      for (let i = 0; i < 100; i++) {
        const idx = i;
        const ret = util.tryQ(() => {
          return idx;
        });
        assert(idx === ret);
      }
    });

    it('should return undefined', () => {
      const ret = util.tryQ(() => {});
      assert(ret === undefined);
    });

    it('should return null', () => {
      const ret = util.tryQ(() => { return null; });
      assert(ret === null);
    });

    it('should return null if throws', () => {
      // eslint-disable-next-line
      const ret = util.tryQ(function() { throw new Error('123'); return 123; });
      assert(ret === null);
    });
  });

  describe('createDeferred', () => {
    it('should resolve', async () => {
      const { promise, resolve } = util.createDeferred();

      setTimeout(() => { resolve(123); }, 100);
      const now = Date.now();
      const ret = await promise;
      assert(Date.now() - now >= 98); // 允许误差
      assert(ret === 123);
    });

    it('should reject', async () => {
      const { promise, reject } = util.createDeferred();

      setTimeout(() => { reject(new Error('123')); }, 100);
      const now = Date.now();
      await assert.rejects(async () => {
        await promise;
      }, /123$/);
      assert(Date.now() - now >= 98); // 允许误差
    });
  });

  describe('bufferFromStream', () => {
    it('should create from stream', async () => {
      const readable = fs.createReadStream(path.join(testUtil.FIXTURES_DIR, 'lorum.txt'));
      const content = fs.readFileSync(path.join(testUtil.FIXTURES_DIR, 'lorum.txt'), 'utf8');
      const buff = await util.bufferFromStream(readable);
      assert(Buffer.isBuffer(buff));
      assert.strictEqual(buff.toString('utf8'), content);
    });
  });

  describe('downloadZipAndExtractToDir', () => {
    before(async () => {
      await testUtil.startResourceServer();
    });

    after(() => {
      testUtil.unlinkTmpDir();
      testUtil.stopResourceServer();
    });

    afterEach(() => { mm.restore(); });

    // TODO: find a way to test properly
    it.skip('should download and extract', async function() {
      this.timeout(10000);

      const COUNT_CMD = 'find . -type f | wc -l';

      const tarball = 'http://127.0.0.1:55331/node-http-demo.zip';
      const target = path.join(testUtil.TMP_DIR(), 'tarball');

      const origJoin = path.join;
      const origUnlink = fs.promises.unlink;
      let origZip = '';
      mm(path, 'join', (...args: any[]) => {
        const ret = origJoin(...args);
        if (args[args.length - 1].endsWith('.zip')) {
          origZip = ret;
        }
        return ret;
      });

      let unlinkError;
      let unlinkCalled = false;
      mm(fs.promises, 'unlink', async (filename: string) => {
        if (filename === origZip) {
          unlinkCalled = true;

          try {
            fs.accessSync(origZip);
          } catch (e) {
            unlinkError = e;
          }
        }

        await origUnlink(filename);

        // dummy error to log
        throw new Error('dummy error');
      });

      const ret = await util.downloadZipAndExtractToDir(tarball, target);
      assert(origZip);
      assert(unlinkCalled);
      assert.strictEqual(unlinkError, undefined);
      assert.throws(() => { fs.accessSync(origZip); }, /no such file or directory/);
      mm.restore();

      const fileCount = cp.execSync(COUNT_CMD, {
        cwd: target,
      }).toString();
      assert.strictEqual(fileCount.trim(), '1526');

      const base = path.join(testUtil.FIXTURES_DIR, 'emp_unit_test_standard');
      walk.walkSync(base, {
        listeners: {
          file: (root, stats, next) => {
            const abs = path.join(root, stats.name);
            const rel = path.relative(base, abs);
            const tmpAbs = path.join(target, rel);

            const a = fs.readFileSync(abs, { encoding: 'utf8' });
            const b = fs.readFileSync(tmpAbs, { encoding: 'utf8' });

            assert(a === b);

            next();
          },
          errors: e => {
            throw e;
          },
        },
      });
      assert(ret === target);
    });

    it('should failed to download', async function() {
      this.timeout(30000);

      const tarball = 'foobar';
      const target = path.join(testUtil.TMP_DIR(), 'tarball2');

      await assert.rejects(async () => {
        await util.downloadZipAndExtractToDir(tarball, target);
      }, /getaddrinfo (.+) foobar/);
    });

    it('should failed to unzip', async () => {
      const tarball = 'http://127.0.0.1:55331/noslate.svg';
      const target = path.join(testUtil.TMP_DIR(), 'tarball3');

      const origJoin = path.join;
      let origZip = '';
      mm(path, 'join', (...args: any[]) => {
        const ret = origJoin(...args);
        if (args[args.length - 1].endsWith('.zip')) {
          origZip = ret;
        }
        return ret;
      });

      await assert.rejects(async () => {
        await util.downloadZipAndExtractToDir(tarball, target);
      }, /End-of-central-directory[\w\W]+unzip:[\w\W]+cannot find zipfile directory in one of/);

      assert.throws(() => { fs.accessSync(origZip); }, /no such file or directory/);
    });

    it('should failed if target directory deleted', async () => {
      const tarball = 'http://127.0.0.1:55331/node-http-demo.zip';
      const target = path.join(testUtil.TMP_DIR(), 'tarball4');

      const origStat = fs.promises.stat;
      mm(fs.promises, 'stat', async (filename: string) => {
        if (filename !== target) return origStat(filename);

        return {
          isDirectory: () => false,
        };
      });

      await assert.rejects(async () => {
        await util.downloadZipAndExtractToDir(tarball, target);
      }, /tarball4 unzip failed\./);
    });

    it('should failed if unzip process failed', async () => {
      const tarball = 'http://127.0.0.1:55331/node-http-demo.zip';
      const target = path.join(testUtil.TMP_DIR(), 'tarball4');

      const origSpawn = cp.spawn;
      mm(cp, 'spawn', (...args: [string, cp.SpawnOptionsWithStdioTuple<cp.StdioNull, cp.StdioNull, cp.StdioNull>]) => {
        const child: cp.ChildProcess = origSpawn(...args);
        if (args[0] === 'unzip') {
          process.nextTick(() => {
            child.emit('error', new Error('hello'));
          });
        }

        return child;
      });

      const origJoin = path.join;
      let origZip: string;
      mm(path, 'join', (...args: any[]) => {
        const ret = origJoin(...args);
        if (args[args.length - 1].endsWith('.zip')) {
          origZip = ret;
        }
        return ret;
      });

      const origUnlink = fs.promises.unlink;
      let unlinkError;
      let unlinkCalled = false;
      mm(fs.promises, 'unlink', async (filename: string) => {
        if (filename === origZip) {
          unlinkCalled = true;

          try {
            fs.accessSync(origZip);
          } catch (e) {
            unlinkError = e;
          }
        }

        await origUnlink(filename);

        // dummy error to log
        throw new Error('dummy error');
      });

      await assert.rejects(async () => {
        await util.downloadZipAndExtractToDir(tarball, target);
      }, /hello/);

      await util.sleep(500); // wait 500ms to delete origZip in `downloadZipAndExtractToDir`

      assert.throws(() => { fs.accessSync(origZip); }, /no such file or directory/);
      assert.strictEqual(unlinkError, undefined);
      assert(unlinkCalled);
    });
  });

  describe('raceEvent', () => {
    it('should remove all event listener on complete', async () => {
      const ee = new EventEmitter();
      const raceFuture = util.raceEvent(ee, [ 'foo', 'bar', 'error' ]);

      ee.emit('foo', 1, 2, 3);
      const [ event, args ] = await raceFuture;
      assert.strictEqual(event, 'foo');
      assert.deepStrictEqual(args, [ 1, 2, 3 ]);

      [ 'foo', 'bar', 'error' ].forEach(it => {
        assert.strictEqual(ee.listenerCount(it), 0);
      });
    });
  });

  describe('setDifference', () => {
    it('should setDifference work', async () => {
      const a = new Set([1, 2, 3]);
      const b = new Set([4, 5, 3]);

      const diffAB = util.setDifference(a, b);
      const diffBA = util.setDifference(b, a);

      assert.deepStrictEqual(diffAB, new Set([1, 2]));
      assert.deepStrictEqual(diffBA, new Set([4, 5]));
    });
  });
});
