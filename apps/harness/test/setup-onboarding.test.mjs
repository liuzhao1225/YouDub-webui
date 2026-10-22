import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
import manifest from '../../../packages/builtin/src/setup-models.json' with { type: 'json' };
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import requirements from '../../../backend/requirements/resources.json' with { type: 'json' };
const source = register({ namespace: 'youdub-onboarding-test' });
const { EnvironmentSetup } = await source.import('../../../packages/builtin/src/setup-environment.ts', import.meta.url);
const { registerSetupRoutes, firstRunBaseResources } = await source.import('../src/backend/setup.mjs', import.meta.url);
const { existingInstallation, installationDirectory, privatePython } = await source.import('../src/backend/installation.mjs', import.meta.url);
after(() => source.unregister());
const normalize = value => [...new Map(value.map(item => [JSON.stringify(item), item])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

async function fixture(t, savedState = {}, readyModels = [], installation) {
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function () { this.steps = [{ id: 'python', status: 'ready' }, { id: 'dependencies', status: 'ready', log: 'bootstrap: installed uv and base dependencies' }]; });
  t.mock.method(EnvironmentSetup.prototype, 'probe', async () => ({ ready: true }));
  const events = new Map(), routes = new Map(), disposers = [], errors = [], writes = [], actions = [], calls = [];
  const transport = { register(method, path, handler) { routes.set(method + ' ' + path, handler); return () => routes.delete(method + ' ' + path); }, json(request, status, value) { request.result = { status, value }; } };
  const models = manifest.map(model => ({ ...model, status: readyModels.includes(model.id) ? 'ready' : 'pending', received: 0, total: model.files.reduce((total, file) => total + file.size, 0), speed: 0 }));
  const items = Object.entries(requirements.providers).filter(([, value]) => value.model).map(([providerId, value]) => ({ providerId, model: value.model.id, downloadId: value.model.downloadId, automatic: true }));
  let started = 0, activated = false, resources;
  const domain = {
    resources: {
      catalogSelections(value) {
        if (!Array.isArray(value) || value.some(item => !item || typeof item.providerId !== 'string')) throw new Error('Invalid resource selection');
        return normalize(value);
      },
      async checkResources(selections) {
        const selected = models.filter(model => items.some(item => item.downloadId === model.id && selections.some(selection => selection.providerId === item.providerId && selection.model === item.model)));
        const requirements = selections.map(selection => ({ ...selection, ready: !selection.model || selected.some(model => model.status === 'ready' && items.some(item => item.downloadId === model.id && item.providerId === selection.providerId && item.model === selection.model)) }));
        return { status: requirements.every(item => item.ready) ? 'ready' : 'missing', selections, requirements, environment: [{ id: 'dependencies', status: 'ready' }], models: selected };
      },
      async prepareResources(selections) {
        calls.push(selections);
        const selected = models.filter(model => items.some(item => item.downloadId === model.id && selections.some(selection => selection.providerId === item.providerId && selection.model === item.model)));
        for (const model of selected) Object.assign(model, { status: 'downloading', received: 10, speed: 1 });
        resources = { status: 'preparing', selections, requirements: selections.map(selection => ({ ...selection, ready: false })), environment: [{ id: 'dependencies', status: 'ready' }], models: selected };
        return resources;
      },
      async resourceInventory() { return { items, models, resources }; },
      async resourceAction(action, id) {
        actions.push({ action, id });
        const targets = resources.models.filter(model => !id || model.id === id);
        if (action === 'pause') { resources.status = 'missing'; for (const model of targets) model.status = 'paused'; }
        else { resources.status = 'preparing'; for (const model of targets) model.status = 'downloading'; delete resources.error; }
      },
    },
    settings: { async read() { return { plugins: { 'youdub.onboarding': savedState } }; }, async patch(value) { writes.push(value); Object.assign(savedState, value.plugin.config); } },
    start() { started++; },
    async inspectTasks() { return false; },
  };
  const ctx = { async inject(dependencies, apply) { assert.deepEqual(dependencies, ['youdubWorker']); apply(ctx); }, on(event, listener) { events.set(event, listener); disposers.push(() => events.delete(event)); }, effect(action) { const dispose = action(); if (dispose) disposers.push(dispose); }, logger: { error(error) { errors.push(error); } }, jobs: {
    attachController() { return () => {}; }, start(spec) { return spec.run({ updateProgress() {} }); },
  } };
  registerSetupRoutes(ctx, transport, { root: '/unused', repoRoot: '/unused', python: '/unused/python', version: 'test' }, async () => { activated = true; return domain; }, installation);
  const request = async (method, body) => { const request = { body }; await routes.get(method + ' /api/setup')(request); return request.result.value; };
  t.after(async () => { for (const dispose of disposers.reverse()) await dispose(); });
  for (let i = 0; !activated && !installation?.required; i++) { assert(i < 30); await new Promise(resolve => setTimeout(resolve, 1)); }
  // Let the same bootstrap turn finish reading the saved preference.
  await new Promise(resolve => setTimeout(resolve, 0));
  return { request, transport, domain, items, models, calls, writes, actions, errors, inspectActivity: () => events.get('desktop/active-tasks')(), get started() { return started; }, get resources() { return resources; } };
}

test('first run requires all four source models and preserves explicit start, pause and retry', async t => {
  const app = await fixture(t);
  let state = await app.request('GET');
  assert.equal(state.phase, 'models'); assert.equal(state.resourceSelection.required, true);
  assert.match(state.environment.find(step => step.id === 'dependencies').log, /bootstrap: installed uv/);
  assert.deepEqual(state.models.map(model => model.id), ['whisper', 'voxcpm', 'demucs', 'qwen']);
  assert.deepEqual(state.resourceSelection.items, app.items);
  assert.equal(state.resourceSelection.selections.length, 6);
  assert.equal(app.calls.length, 0); assert.equal(app.started, 0); assert.equal(app.writes.length, 0);
  assert.throws(() => app.transport.assertReady('/api/v2/tasks'), error => error.code === 'ENVIRONMENT_NOT_READY');
  await assert.rejects(app.request('POST', { action: 'resume' }), error => error.code === 'MODEL_SELECTION_REQUIRED');
  await assert.rejects(app.request('POST', { action: 'prepare', selections: [] }), error => error.code === 'INVALID_INPUT');
  await assert.rejects(app.request('POST', { action: 'prepare', selections: [{ providerId: 'unknown', model: 'huge' }] }), error => error.code === 'INVALID_INPUT');
  assert.equal(app.calls.length, 0);
  await assert.rejects(app.request('POST', { action: 'prepare', selections: [{ providerId: 'whisper', model: 'tiny' }] }), error => error.code === 'INVALID_INPUT' && error.message.includes('全部四项'));
  assert.equal(app.calls.length, 0);
  const selections = app.items.map(({ providerId, model }) => ({ providerId, model }));
  const expected = normalize([...firstRunBaseResources, ...selections]);
  state = await app.request('POST', { action: 'prepare', selections });
  assert.deepEqual(app.calls, [expected]); assert.deepEqual(state.resourceSelection.selections, expected);
  app.resources.environment[0].log = 'models: installed inference dependencies';
  const logs = (await app.request('GET')).environment.find(step => step.id === 'dependencies').log;
  assert.match(logs, /bootstrap: installed uv/); assert.match(logs, /models: installed inference/);
  assert.equal(state.resourceSelection.required, false); assert.equal(state.models.length, 4); assert.equal(state.models[0].received, 10);
  assert.deepEqual(app.writes[0].plugin.config, { resourceSelections: expected, resourcesPrepared: false });
  state = await app.request('POST', { action: 'pause', id: 'whisper' }); assert.equal(state.models[0].status, 'paused');
  await app.request('POST', { action: 'resume', id: 'whisper' });
  const model = app.resources.models.find(model => model.id === 'qwen');
  app.resources.status = 'failed'; app.resources.error = 'original checksum mismatch'; model.status = 'failed'; model.error = app.resources.error;
  state = await app.request('GET'); assert.equal(state.phase, 'models'); assert.equal(state.error, 'original checksum mismatch'); assert.equal(app.started, 0);
  await app.request('POST', { action: 'retry', id: 'qwen' });
  app.resources.status = 'ready'; for (const item of app.resources.models) { item.status = 'ready'; item.received = item.total; }
  for (const item of app.resources.requirements) item.ready = true;
  state = await app.request('GET'); assert.equal(state.phase, 'ready'); assert.equal(state.resourceSelection.prepared, true); assert.equal(app.started, 1);
  assert.deepEqual(app.writes[1].plugin.config, { resourceSelections: expected, resourcesPrepared: true });
  await app.request('GET'); assert.equal(app.started, 1); assert.equal(app.writes.length, 2);
  assert.doesNotThrow(() => app.transport.assertReady('/api/v2/tasks'));
  assert.deepEqual(app.actions.map(item => item.action), ['pause', 'resume', 'retry']); assert.deepEqual(app.errors, []);
});

test('unfinished partial setup requires the complete source manifest without silently starting downloads', async t => {
  const selection = [{ providerId: 'demucs', model: 'htdemucs' }];
  const app = await fixture(t, { resourcesPrepared: false, resourceSelections: selection });
  const state = await app.request('GET');
  assert.equal(state.resourceSelection.required, true);
  assert.deepEqual(state.resourceSelection.selections, normalize([...firstRunBaseResources, ...app.items.map(({ providerId, model }) => ({ providerId, model }))]));
  assert.equal(app.calls.length, 0); assert.equal(app.started, 0);
});

test('a failed selection or completion write preserves the original error and does not release tasks', async t => {
  const app = await fixture(t);
  const selections = app.items.map(({ providerId, model }) => ({ providerId, model }));
  const error = new Error('official preference write failed');
  const patch = t.mock.method(app.domain.settings, 'patch', async () => { throw error; });
  await assert.rejects(app.request('POST', { action: 'prepare', selections }), failure => failure === error);
  assert.equal(app.calls.length, 0); assert.equal(app.started, 0);
  assert.equal((await app.request('GET')).error, error.message);
  patch.mock.restore();
  await app.request('POST', { action: 'prepare', selections });
  app.resources.status = 'ready'; for (const item of app.resources.models) item.status = 'ready';
  for (const item of app.resources.requirements) item.ready = true;
  t.mock.method(app.domain.settings, 'patch', async () => { throw error; });
  const failed = await app.request('GET');
  assert.equal(failed.phase, 'failed'); assert.equal(failed.error, error.message);
  assert.equal(failed.resourceSelection.prepared, false); assert.equal(app.started, 0);
  assert.deepEqual(app.errors, [error]);
  assert.throws(() => app.transport.assertReady('/api/v2/tasks'), failure => failure.code === 'ENVIRONMENT_NOT_READY');
});

test('restart verifies actual full resources instead of trusting a completion flag', async t => {
  await t.test('legacy completion marker still exposes the complete model preparation', async t => {
    const app = await fixture(t, { resourcesPrepared: true });
    const state = await app.request('GET');
    assert.equal(state.resourceSelection.required, true); assert.equal(state.models.length, 4); assert.equal(app.started, 0);
  });
  await t.test('old Whisper-only completion preserves Whisper and requires the other models', async t => {
    const selection = [{ providerId: 'whisper', model: 'tiny' }];
    const app = await fixture(t, { resourcesPrepared: true, resourceSelections: selection }, ['whisper']);
    const state = await app.request('GET');
    assert.equal(state.phase, 'models'); assert.equal(state.resourceSelection.required, true); assert.equal(state.resourceSelection.prepared, false);
    assert.equal(state.models.find(model => model.id === 'whisper').status, 'ready');
    assert.deepEqual(state.models.filter(model => model.status !== 'ready').map(model => model.id), ['voxcpm', 'demucs', 'qwen']);
    assert.equal(state.resourceSelection.selections.length, 6); assert.equal(app.calls.length, 0); assert.equal(app.started, 0);
    assert.throws(() => app.transport.assertReady('/api/v2/tasks'), error => error.code === 'ENVIRONMENT_NOT_READY');
  });
  await t.test('complete selection still rechecks missing model files', async t => {
    const selection = Object.entries(requirements.providers).filter(([, value]) => value.model).map(([providerId, value]) => ({ providerId, model: value.model.id }));
    const app = await fixture(t, { resourcesPrepared: true, resourceSelections: selection }, ['whisper', 'demucs', 'voxcpm']);
    const state = await app.request('GET');
    assert.equal(state.phase, 'models'); assert.equal(state.resourceSelection.required, true); assert.equal(app.started, 0); assert.equal(app.calls.length, 0);
  });
  await t.test('all four actual models and dependencies restore completion', async t => {
    const app = await fixture(t, { resourcesPrepared: true }, manifest.map(model => model.id));
    const state = await app.request('GET');
    assert.equal(state.phase, 'ready'); assert.equal(state.resourceSelection.prepared, true);
    assert.equal(app.calls.length, 0); assert.equal(app.started, 1);
  });
});

test('resource ready cannot release tasks with missing model or dependency readiness', async t => {
  for (const gap of ['model', 'dependency', 'environment']) await t.test(gap, async t => {
    const app = await fixture(t);
    await app.request('POST', { action: 'prepare', selections: app.items.map(({ providerId, model }) => ({ providerId, model })) });
    app.resources.status = 'ready';
    for (const model of app.resources.models) model.status = 'ready';
    for (const item of app.resources.requirements) item.ready = true;
    if (gap === 'model') app.resources.models.find(model => model.id === 'voxcpm').status = 'pending';
    else if (gap === 'dependency') app.resources.requirements[0].ready = false;
    else app.resources.environment[0].status = 'pending';
    const state = await app.request('GET');
    assert.equal(state.phase, 'failed'); assert.match(state.error, /尚未全部就绪/); assert.equal(state.resourceSelection.prepared, false); assert.equal(app.started, 0);
    assert.throws(() => app.transport.assertReady('/api/v2/tasks'), error => error.code === 'ENVIRONMENT_NOT_READY');
  });
});


test('desktop activity follows the initialized domain instead of first-run completion alone', async t => {
  const app = await fixture(t);
  assert.equal((await app.request('GET')).phase, 'models');
  assert.equal(await app.inspectActivity(), false);
  app.domain.inspectTasks = async () => true;
  assert.equal(await app.inspectActivity(), true);
  const error = new Error('Task storage unavailable');
  app.domain.inspectTasks = async () => { throw error; };
  await assert.rejects(app.inspectActivity(), value => value === error);
});


test('first launch waits for a confirmed directory and preserves a configuration failure', async t => {
  const configured = [];
  const app = await fixture(t, {}, [], { required: true, path: '/unused', async configure(path) {
    if (path === 'invalid') throw new Error('Directory is not writable');
    configured.push(path); return { root: path, python: path + '/runtime/venv/bin/python' };
  } });
  let state = await app.request('GET');
  assert.equal(state.phase, 'installation');
  assert.equal(state.environment.length, 0);
  assert.equal(app.started, 0);
  assert.equal(await app.inspectActivity(), false);
  await assert.rejects(app.request('POST', { action: 'retry' }), { code: 'INSTALLATION_REQUIRED' });
  await assert.rejects(app.request('POST', { action: 'configure', path: 'invalid' }), /Directory is not writable/);
  assert.equal((await app.request('GET')).phase, 'installation');
  await app.request('POST', { action: 'configure', path: '/selected/YouDub' });
  await new Promise(resolve => setTimeout(resolve, 0));
  state = await app.request('GET');
  assert.equal(state.installation.path, '/selected/YouDub');
  assert.equal(state.phase, 'models');
  assert.equal(state.models.length, 4);
  assert.deepEqual(configured, ['/selected/YouDub']);
  await assert.rejects(app.request('POST', { action: 'configure', path: '/different' }), { code: 'SETUP_BUSY' });
});


test('installation validates an independent writable directory and recognizes existing data', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'youdub-installation-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  assert.equal(await existingInstallation(folder), false);
  await assert.rejects(installationDirectory('relative/path'), { code: 'INVALID_INSTALL_DIRECTORY' });
  await assert.rejects(installationDirectory(parse(folder).root), { code: 'INVALID_INSTALL_DIRECTORY' });
  const selected = await installationDirectory(join(folder, 'private YouDub'));
  assert.equal(await existingInstallation(selected), false);
  assert(privatePython(selected).startsWith(selected));
  await mkdir(join(selected, 'runtime'));
  assert.equal(await existingInstallation(selected), true);
});
