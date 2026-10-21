import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { prepareYouDubProfile } from '../prepare-profile.mjs';
import { assertYouDubProfile } from '../check-profile.mjs';

const here = resolve(import.meta.dirname, '..');
const source = resolve(here, '../../vendor/deepseek-harness/source');
const sourceBuild = resolve(here, '../../.cache/harness/source-build');
const sourceRequire = createRequire(join(sourceBuild, 'packages/boot/plugin-manager/package.json'));
const packageManager = { command: process.execPath, args: [resolve(here, '../../.cache/harness/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs')] };
const { runPluginCommand } = await import(pathToFileURL(join(sourceBuild, 'packages/boot/plugin-manager/lib/types/operations.js')));
const required = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@youdub/harness-subtitles'];
const fixture = join(import.meta.dirname, 'fixtures/file-transform');
const fixtureName = '@youdub/harness-example-file-transform';
const readManifest = async profile => JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
const saveManifest = (profile, manifest) => writeFile(join(profile, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');

async function copyBundle(from, to) {
  const manifest = await readManifest(from);
  await mkdir(to, { recursive: true });
  await copyFile(join(from, 'package.json'), join(to, 'package.json'));
  for (const patch of [manifest.dsh.bundle.patch].flat()) {
    await mkdir(dirname(join(to, patch)), { recursive: true });
    await copyFile(join(from, patch), join(to, patch));
  }
}

async function temporaryProfile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'youdub-profile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // The desktop launcher replaces its runtime project. Give the real parser
  // a private application anchor and unchanged source bundle files instead.
  const runtime = join(directory, 'application'), plugin = join(runtime, 'youdub-plugin');
  await copyBundle(here, plugin);
  await saveManifest(runtime, { name: 'youdub-profile-test', private: true, type: 'module' });
  for (const [name, path] of [['@deepseek-ai/dsh-base', 'packages/bundle/base'], ['@deepseek-ai/dsh-web-app', 'packages/bundle/web-app']]) {
    await copyBundle(join(source, path), join(runtime, 'node_modules', name));
  }
  await symlink(join(source, 'packages/client/ui-layout'), join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-layout'), 'dir');
  await symlink(join(sourceBuild, 'packages/boot/app-boot'), join(runtime, 'node_modules/@deepseek-ai/dsh-app-boot'), 'dir');
  await symlink(join(sourceBuild, 'packages/boot/plugin-manager'), join(runtime, 'node_modules/@deepseek-ai/dsh-plugin-manager'), 'dir');
  await symlink(dirname(sourceRequire.resolve('yaml/package.json')), join(runtime, 'node_modules/yaml'), 'dir');
  const profile = join(directory, 'profiles/youdub');
  await prepareYouDubProfile(profile, plugin, runtime, packageManager);
  return { profile, plugin, runtime };
}

test('profile restart preserves an appended plugin bundle, dependency and user patch', async t => {
  const { profile, plugin, runtime } = await temporaryProfile(t);
  const manifest = await readManifest(profile);
  manifest.dsh.profile.bundles.push(fixtureName);
  manifest.dependencies[fixtureName] = `link:${fixture}`;
  await saveManifest(profile, manifest);
  const fixtureLink = join(profile, 'node_modules', fixtureName);
  await mkdir(dirname(fixtureLink), { recursive: true });
  await symlink(fixture, fixtureLink, 'dir');
  const patch = '# User profile settings survive preparation.\n[]\n';
  await writeFile(join(profile, 'cordis.patch.yml'), patch);

  await prepareYouDubProfile(profile, plugin, runtime, packageManager);
  await prepareYouDubProfile(profile, plugin, runtime, packageManager);

  assert.deepEqual(await readManifest(profile), manifest);
  assert.equal(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'), patch);
  assert.equal(await realpath(fixtureLink), await realpath(fixture));
  const parsed = await assertYouDubProfile(profile, join(runtime, 'package.json'));
  assert.deepEqual(parsed.layers.map(layer => layer.packageName), [...required, fixtureName]);
  assert.deepEqual(parsed.skippedBundles, []);
  assert.equal(parsed.layers.at(-1).patches[0].insert[0].id, 'youdub-example-file-transform');
});

test('profile helpers require the explicit runtime app-boot without falling back to launcher dependencies', async t => {
  const { profile, plugin, runtime } = await temporaryProfile(t);
  await rm(join(runtime, 'node_modules/@deepseek-ai/dsh-app-boot'));
  const missingRuntimeModule = error => error.code === 'MODULE_NOT_FOUND' && error.message.includes('@deepseek-ai/dsh-app-boot');
  await assert.rejects(prepareYouDubProfile(profile, plugin, runtime, packageManager), missingRuntimeModule);
  await assert.rejects(assertYouDubProfile(profile, join(runtime, 'package.json')), missingRuntimeModule);
});

test('official composition keeps YouDub dependencies without coding agents or DeepSeek product services', async t => {
  const { profile, runtime } = await temporaryProfile(t);
  const parsed = await assertYouDubProfile(profile, join(runtime, 'package.json'));
  const { composeEntries } = await import(pathToFileURL(join(sourceBuild, 'packages/boot/app-boot/lib/index.js')));
  const entries = composeEntries([...parsed.layers.map(layer => layer.patches), parsed.patches]);
  const rows = new Map(entries.map(entry => [entry.id, entry]));
  for (const id of ['agent-loop', 'tools', 'system-prompt', 'session-title-llm', 'llm-retry',
    'subagent', 'subagent-spawn-in-process', 'subagent-fork-in-process', 'schedule', 'goal',
    'agent-preset-registry', 'preset-standard', 'preset-ptc', 'preset-minimal', 'preset-cordis',
    'terminal-controller', 'workspace-files', 'workspace-changes', 'web-search-deepseek', 'web-fetch-http',
    'cordis-host-runner', 'cordis-client-runner', 'skill', 'mcp-resources',
    'deepseek-account', 'account-controller', 'llm-deepseek', 'llm-deepseek-account',
    'product-analytics', 'desktop-product-telemetry', 'ui-chat', 'ui-conversation', 'ui-settings-account']) {
    assert.equal(rows.get(id)?.disabled, true, `${id} must not run in YouDub`);
  }
  for (const id of ['llm', 'llm-pi-ai', 'credentials', 'settings', 'subprocess', 'jobs', 'connection',
    'modules', 'session-controller', 'file-upload', 'plugin-manager', 'ui-layout', 'ui-renderer',
    'ui-theme', 'locale', 'ui-settings', 'ui-settings-general', 'ui-settings-models', 'youdub-subtitles']) {
    assert(rows.has(id), `${id} must be provided by the official composition`);
    assert.notEqual(rows.get(id).disabled, true, `${id} is a required YouDub dependency`);
  }
  assert.deepEqual(rows.get('agent-default-model').config, { provider: '', model: '' });
});

for (const [index, name] of required.entries()) {
  for (const kind of ['missing', 'wrong']) {
    test(`profile preparation rejects ${kind} required bundle ${name}`, async t => {
      const { profile, plugin, runtime } = await temporaryProfile(t);
      const manifest = await readManifest(profile);
      if (kind === 'missing') manifest.dsh.profile.bundles.splice(index, 1);
      else manifest.dsh.profile.bundles[index] = fixtureName;
      await saveManifest(profile, manifest);

      await assert.rejects(prepareYouDubProfile(profile, plugin, runtime, packageManager), error => {
        assert.equal(error.message, `Unexpected YouDub profile composition: ${join(profile, 'package.json')}`);
        return true;
      });
      assert.deepEqual(await readManifest(profile), manifest);
    });
  }
}

test('official package removal keeps the source SDK after migrating a stale dependency lock', async t => {
  const { profile, plugin, runtime } = await temporaryProfile(t);
  const oldPlugin = join(runtime, 'old-youdub-plugin');
  await copyBundle(here, oldPlugin);
  const operation = async args => {
    const result = await runPluginCommand({ profile: 'youdub', dir: profile, installAnchor: join(runtime, 'package.json'), cwd: runtime }, args,
      { ...packageManager, execution: 'service', outputBytes: 32_768, activateNewBundles: false });
    assert.equal(result.exitCode, 0, result.output);
  };
  await operation(['add', oldPlugin, fixture, '--offline']);
  assert.equal(await realpath(join(profile, 'node_modules/@youdub/harness-subtitles')), await realpath(oldPlugin));
  await prepareYouDubProfile(profile, plugin, runtime, packageManager);
  assert.equal((await readManifest(profile)).dependencies[fixtureName], `link:${fixture}`);
  const { parse } = sourceRequire('yaml');
  const lock = parse(await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8'));
  assert.equal(lock.importers['.'].dependencies['@youdub/harness-subtitles'].specifier, `link:${plugin}`);
  await operation(['remove', fixtureName, '--config.offline=true']);
  assert.equal(await realpath(join(profile, 'node_modules/@youdub/harness-subtitles')), await realpath(plugin));
  assert.equal((await readManifest(profile)).dependencies['@youdub/harness-subtitles'], `link:${plugin}`);
  assert.equal((await readManifest(profile)).dependencies[fixtureName], undefined);
});
