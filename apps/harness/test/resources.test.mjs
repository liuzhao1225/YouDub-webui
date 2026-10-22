import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { register } from 'tsx/esm/api';
const source = register({ namespace: 'youdub-resources-test' });
const { default: Resources } = await source.import('../src/backend/resources.ts', import.meta.url);
const { EnvironmentSetup } = await source.import('../../../packages/builtin/src/setup-environment.ts', import.meta.url);
const { builtinResources } = await source.import('../../../packages/builtin/src/runtime-resources.ts', import.meta.url);
after(() => source.unregister());

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-resource-state-'));
  const installed = new Set(['base']), prepared = [], jobs = [];
  t.mock.method(EnvironmentSetup.prototype, 'probe', async (_action, groups = ['base']) => {
    if (_action === 'acceleration-plan') return { installed: installed.has('acceleration') || installed.has('whisper'), detail: 'CPU' };
    if (_action === 'acceleration') return { backend: 'cpu', devices: [], detail: 'CPU checked' };
    return { missing: groups.filter(group => !installed.has(group)), media: installed.has('media') || !groups.includes('media'), punkt: installed.has('punkt') || installed.has('whisper') || !groups.some(group => ['punkt', 'whisper'].includes(group)), demucsSource: true };
  });
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(groups) {
    prepared.push(groups); for (const group of groups) installed.add(group);
    this.steps = [{ id: 'python', name: 'Python', status: 'ready' }, { id: 'dependencies', name: 'Dependencies', status: 'ready' }];
  });
  t.mock.method(Resources.prototype, 'refreshModelSizes', async models => { for (const model of models) if (!['paused', 'failed'].includes(model.status)) model.status = 'ready'; });
  const providers = [{ id: 'youdub.media', label: 'FFmpeg', resources: builtinResources('youdub.media'), execution: 'local', available: true },
    { id: 'whisper', label: 'Whisper', resources: builtinResources('whisper'), execution: 'local', available: true, models: [{ id: 'tiny' }] }];
  const ctx = new Context();
  const deps = ctx.plugin({ name: 'resource-fixture', apply(child) {
    child.reflect.provide('catalog', { listProviders: () => providers, provider: () => ({ probe: async () => {} }) });
    child.reflect.provide('youdubWorker', { run: async () => ({ stdout: '3.12.12', stderr: '' }) });
    child.reflect.provide('jobs', { start(spec) { const job = spec.run(); jobs.push(job.done); return job; } });
  } }); await deps;
  const service = ctx.plugin(Resources, { root, repoRoot: root, python: '/python', version: 'test', modelRoots: { whisper: root } }); await service;
  t.after(async () => { await service.dispose(); await deps.dispose(); await rm(root, { recursive: true, force: true }); });
  const finish = async () => { await Promise.all(jobs); await new Promise(resolve => setImmediate(resolve)); };
  return { resources: ctx.youdubResources, providers, installed, prepared, finish };
}

test('direct shared resource preparation has a bounded dependency scope and no model downloads', async t => {
  const app = await fixture(t);
  for (const [id, groups] of [['acceleration', ['base', 'acceleration']], ['resources', ['base', 'punkt']], ['ffmpeg', ['base', 'media']]]) {
    const target = await app.resources.resourceTargets([id]);
    const checked = await app.resources.checkResources(target);
    assert.equal(checked.entries.find(item => item.id === id).status, 'missing');
    await app.resources.prepareResources(target); await app.finish();
    assert.deepEqual(app.prepared.at(-1), groups);
    const result = await app.resources.checkResources(target);
    assert.equal(result.status, 'ready'); assert.equal(result.entries.find(item => item.id === id).status, 'ready');
    assert.equal(result.models.length, 0);
  }
  await assert.rejects(app.resources.resourceTargets(['arbitrary-package']), /未知资源/);
});

test('preparing an existing model installs its missing dependencies and reports one usable entry', async t => {
  const app = await fixture(t), target = await app.resources.resourceTargets(['whisper']);
  const before = await app.resources.checkResources(target);
  assert.equal(before.models[0].status, 'ready');
  assert.equal(before.entries.find(item => item.id === 'whisper').status, 'missing');
  await app.resources.prepareResources(target); await app.finish();
  assert.deepEqual(app.prepared, [['base', 'media', 'whisper']]);
  const after = await app.resources.checkResources(target);
  assert.equal(after.status, 'ready');
  assert.deepEqual(after.entries.filter(item => item.id === 'whisper').map(item => item.status), ['ready']);
});

test('a different workflow reads the active preparation for its shared resources', async t => {
  const app = await fixture(t);
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(groups) {
    this.steps = [{ id: 'python', name: 'Python', status: 'ready' }, { id: 'dependencies', name: 'Dependencies', status: 'running' }];
    await waiting;
    for (const group of groups) app.installed.add(group);
    this.steps[1].status = 'ready';
  });
  try {
    await app.resources.prepareResources(await app.resources.resourceTargets(['whisper']));
    const other = await app.resources.checkResources(await app.resources.resourceTargets(['whisper', 'ffmpeg']));
    assert.equal(other.activePreparation.status, 'preparing');
    assert.equal(other.entries.find(item => item.id === 'whisper').status, 'preparing');
    assert.equal(other.entries.find(item => item.id === 'whisper').phase, 'installing');
  } finally { release(); await app.finish(); }
});

test('an additional installed model keeps its own identity beside the managed default', async t => {
  const app = await fixture(t);
  app.providers[1].models.push({ id: 'small' });
  const result = await app.resources.checkResources([{ providerId: 'whisper', model: 'tiny' }, { providerId: 'whisper', model: 'small' }]);
  const models = result.entries.filter(item => item.group === 'model');
  assert.deepEqual(models.map(item => item.id), ['whisper:small', 'whisper']);
  assert.equal(models[0].variant, 'small');
  assert.deepEqual(models[0].actions, []);
});

test('pausing one download still verifies the resources that already completed', async t => {
  const app = await fixture(t);
  app.providers.push({ id: 'demucs', label: 'Demucs', resources: builtinResources('demucs'), execution: 'local', available: true, models: [{ id: 'htdemucs' }] });
  app.resources.models.find(model => model.id === 'whisper').status = 'paused';
  await app.resources.prepareResources(await app.resources.resourceTargets(['whisper', 'demucs']));
  await app.finish();
  const result = (await app.resources.resourceInventory()).resources;
  assert.equal(result.entries.find(item => item.id === 'whisper').status, 'paused');
  assert.equal(result.entries.find(item => item.id === 'demucs').status, 'ready');
});
