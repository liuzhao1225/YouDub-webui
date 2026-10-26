import test from 'node:test';
import assert from 'node:assert/strict';
import { youdubEnvironment } from '../product-environment.mjs';

test('YouDub excludes Harness overrides while keeping its own configuration and system environment', () => {
  const inherited = { DSH_HOME: 'Harness data', dsh_desktop_primary_runtime_dir: 'Harness runtime',
    DSH_DESKTOP_PNPM_ENTRY: 'Harness pnpm', YOUDUB_HOME: 'YouDub data', PATH: 'system tools', HTTPS_PROXY: 'proxy' };
  assert.deepEqual(youdubEnvironment(inherited), { YOUDUB_HOME: 'YouDub data', PATH: 'system tools', HTTPS_PROXY: 'proxy' });
  assert.equal(inherited.DSH_HOME, 'Harness data');
});
