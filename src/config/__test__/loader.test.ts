import * as common from '#self/test/common';
import { resolveConfig, resolveEnvConfig } from '#self/config/loader';
import defaultConfig from '#self/config/default';
import assert from 'assert';
import { join } from 'path';
import { FIXTURES_DIR } from '#self/test/util';
import extend from 'extend';

describe(common.testName(__filename), () => {
  describe('Config Loader', () => {
    it('should resolveConfig work base default and env', async () => {
      const config = resolveConfig();
      const defaultConfigWithEnv: any = extend(true, {}, defaultConfig, resolveEnvConfig());

      assert.deepStrictEqual(defaultConfigWithEnv, config);
    });

    it('should resolveConfig with config file', async () => {
      process.env.NOSLATED_CONFIG_PATH = join(FIXTURES_DIR, 'mockConfig.json');

      const config = resolveConfig();

      assert(config.virtualMemoryPoolSize, '16gb');

      process.env.NOSLATED_CONFIG_PATH = undefined;
    });

    it('should resolveConfig when config file nonexist', async () => {
      process.env.NOSLATED_CONFIG_PATH = '/nonexistfile';

      resolveConfig();

      process.env.NOSLATED_CONFIG_PATH = undefined;
    });
  });
});
