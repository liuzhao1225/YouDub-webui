import assert from 'node:assert/strict';
import test from 'node:test';
import { FileMatcher, getNodeModuleFileMatcher } from 'app-builder-lib/out/fileMatcher.js';
import { desktopFiles, productResources } from '../package-files.mjs';

test('product resources retain runtime requirement groups without development and migration test inputs', () => {
  const filter = new FileMatcher('/workspace', '/output', value => value, productResources).createFilter();
  const includes = path => filter('/workspace/' + path, { isDirectory: () => false });
  for (const path of ['backend/app/config.py', 'backend/workers/store.py', 'backend/requirements/base.txt', 'backend/requirements/whisper.txt', 'backend/requirements/resources.json']) {
    assert.equal(includes(path), true, path);
  }
  for (const path of ['backend/requirements-test.txt', 'backend/tests/fixtures/legacy_schema_v1.sql', 'backend/tests/test_plugin_store.py']) {
    assert.equal(includes(path), false, path);
  }
});

test('desktop dependency selection keeps executable modules and assets without framework sources', () => {
  const matcher = getNodeModuleFileMatcher('/app', '/output', value => value, {}, {
    config: { files: desktopFiles }, debugLogger: { isEnabled: false },
  });
  const filter = matcher.createFilter();
  const includes = (path, directory = false) => filter('/workspace/' + path, {
    moduleFullFilePath: 'node_modules/' + path, isDirectory: () => directory,
  });
  for (const path of [
    '@deepseek-ai/dsh-client-ui-theme/src',
    '@deepseek-ai/dsh-client-ui-theme/src/client/index.ts',
    '@deepseek-ai/dsh/tsconfig.json',
    '@deepseek-ai/dsh/tsdown.config.ts',
    '@deepseek-ai/dsh/README.zh.md',
    '@deepseek-ai/dsh-client-web/tests/boot-page.client.spec.ts',
    '@deepseek-ai/dsh-web-frontend/public/favicon.svg',
    '@deepseek-ai/dsh-web-frontend/index.html',
    '@deepseek-ai/dsh-client-ui-theme/lib/client.js.map',
    'react-dom/cjs/react-dom.development.js.map',
    'openai/src/index.ts',
    'zod/src/v4/core/tests/index.test.ts',
    '@anthropic-ai/sdk/src/index.ts',
    'gaxios/build/esm/test/test.index.js',
  ]) assert.equal(includes(path, path.endsWith('/src')), false, path);
  for (const path of [
    '@deepseek-ai/dsh/package.json',
    '@deepseek-ai/dsh/lib/index.js',
    '@deepseek-ai/dsh-settings/lib/types/schema.js',
    '@deepseek-ai/dsh-client-ui-theme/lib/client.js',
    '@deepseek-ai/dsh-client-ui-theme/lib/styles/brand-font.css',
    '@deepseek-ai/dsh-client-ui-theme/locale/zh-CN.json',
    '@deepseek-ai/dsh-web-frontend/dist/index.html',
    '@deepseek-ai/dsh-web-frontend/dist/assets/app.js',
    '@deepseek-ai/dsh/NOTICE',
    'third-party/src/index.js',
    'openai/index.mjs',
    'zod/v4/core/index.js',
    '@anthropic-ai/sdk/index.js',
    'gaxios/build/esm/src/index.js',
    '@koromix/koffi-darwin-arm64/koffi.node',
  ]) assert.equal(includes(path), true, path);
});
