import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local';
import LocalJobs from '@deepseek-ai/dsh-jobs-local';
import * as host from '../dist/host.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const python = process.env.YOUDUB_TEST_PYTHON || join(repo, '.venv/bin/python');

test('official Host scope preserves root services and requires all first-run models before domain APIs', { timeout: 45_000 }, async t => {
  const data = await mkdtemp(join(repo, '.native-test-'));
  await mkdir(join(data, 'runtime'));
  const previousNode = process.env.YOUDUB_NODE_PATH;
  const node = createRequire(import.meta.url)('electron');
  const previousNodeMode = process.env.ELECTRON_RUN_AS_NODE;
  process.env.YOUDUB_NODE_PATH = node;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  t.after(() => { if (previousNodeMode === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = previousNodeMode; });
  t.after(() => { if (previousNode === undefined) delete process.env.YOUDUB_NODE_PATH; else process.env.YOUDUB_NODE_PATH = previousNode; });
  const ctx = new Context(), handlers = new Map();
  const sub = ctx.plugin(LocalSubprocess); await sub;
  const jobs = ctx.plugin(LocalJobs); await jobs;
  let preferences = { ui_language: 'zh', defaults: null, plugins: { 'youdub.onboarding': { resourcesPrepared: true, resourceSelections: [{ providerId: 'whisper', model: 'tiny' }] } }, connections: [] }, revision = 0;
  const forms = { describe: () => [{ ns: 'youdub-subtitles', value: { preferences }, revision }], update: async (ns, patch, expected) => {
    assert.equal(ns, 'youdub-subtitles'); assert.equal(expected, revision); preferences = patch.preferences; revision++;
  } };
  const services = ctx.plugin({ name: 'test-native-seams', apply(child) {
    child.reflect.provide('connection', { fetch: { register(route) { assert(!handlers.has(route.path)); handlers.set(route.path, route); return () => handlers.delete(route.path); } } });
    child.reflect.provide('settings', forms);
    child.reflect.provide('credentials', { describe: async () => ({ configured: false }), resolve: async () => undefined });
    child.reflect.provide('llm', { listProviders: () => [], listConfigurableProviders: () => [] });
    child.reflect.provide('pluginManager', { listBundles: async () => [], listPlugins: async () => [] });
  } }); await services;
  const plugin = ctx.plugin({ name: host.name, inject: host.inject, apply: child => host.apply(child, { python, modelsDir: join(data, 'models/whisper'), dataDir: data, installation: { get: () => null }, preferences: { get: () => preferences } }) });
  const watchdog = setTimeout(() => console.error('Host activation pending', plugin.status), 10000);
  try {
    await plugin; clearTimeout(watchdog);
    assert.equal(ctx.settings, forms); assert.equal(Object.hasOwn(ctx, 'process'), false);
    assert(handlers.has('/api/youdub/v2')); assert(handlers.has('/api/youdub/upload'));
    const call = async (method, path, body) => {
      const result = await handlers.get('/api/youdub/v2').fetch(new Request('http://localhost/api/youdub/v2', { method: 'POST', body: JSON.stringify({ method, path, body }) }));
      return { status: result.status, body: result.status === 204 ? null : await result.json() };
    };
    for (let attempt = 0; ; attempt++) {
      const setup = await call('GET', '/api/setup');
      assert.equal(setup.status, 200);
      assert.notEqual(setup.body.phase, 'failed', setup.body.error);
      if (setup.body.phase === 'models') {
        assert.equal(setup.body.resourceSelection.required, true);
        assert.equal(setup.body.resourceSelection.prepared, false);
        assert.deepEqual(setup.body.models.map(model => [model.id, model.status]), [['whisper', 'pending'], ['voxcpm', 'pending'], ['demucs', 'pending'], ['qwen', 'pending']]);
        assert.equal(setup.body.resourceSelection.selections.length, 6);
        assert.equal(preferences.plugins['youdub.onboarding'].resourcesPrepared, true, 'The legacy marker is retained without being treated as current readiness');
        break;
      }
      assert(attempt < 300, `Base environment did not reach full model preparation: ${setup.body.phase}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(ctx.jobs.list().some(job => job.kind === 'youdub-environment'));
    await t.test('official workers resolve private media, model and cache directories without user-site packages', async childTest => {
      const parentPythonHome = process.env.PYTHONHOME;
      process.env.PYTHONHOME = '/machine/python-home-that-must-not-be-used';
      childTest.after(() => { if (parentPythonHome === undefined) delete process.env.PYTHONHOME; else process.env.PYTHONHOME = parentPythonHome; });
      const result = await ctx.youdubWorker.run({ command: python, cwd: repo, args: ['-c', 'import json, os, site, subprocess; print(json.dumps({"node": json.loads(subprocess.check_output([os.environ["YOUDUB_NODE_PATH"], "-p", "JSON.stringify({executable: process.execPath, electron: process.versions.electron})"], text=True)), "userSite": site.ENABLE_USER_SITE, "paths": {name: os.environ[name] for name in ["YOUDUB_NODE_PATH", "FFMPEG_PATH", "FFPROBE_PATH", "NLTK_DATA", "PIP_CACHE_DIR", "HF_HOME", "HF_HUB_CACHE", "TORCH_HOME", "MODELSCOPE_CACHE", "YOUDUB_WHISPER_MODELS_DIR", "YOUDUB_VOXCPM_MODEL_DIR", "YOUDUB_DEMUCS_MODELS_DIR", "YOUDUB_FORCED_ALIGNER_MODEL_DIR"]}}))'] });
      const runtime = JSON.parse(result.stdout);
      assert.equal(runtime.userSite, false);
      for (const [name, path] of Object.entries(runtime.paths)) {
        if (name !== 'YOUDUB_NODE_PATH') assert(path.startsWith(data + sep), `${name} escaped the YouDub data directory: ${path}`);
      }
      assert.equal(await realpath(runtime.node.executable), await realpath(node));
      assert.equal(runtime.node.electron, JSON.parse(await readFile(join(repo, 'apps/harness/node_modules/electron/package.json'), 'utf8')).version);
      assert.equal(runtime.paths.FFMPEG_PATH.includes(`${sep}runtime${sep}ffmpeg${sep}`), true);
      assert.equal(runtime.paths.YOUDUB_NODE_PATH, process.env.YOUDUB_NODE_PATH);
    });
    await t.test('the isolated domain exposes all native operations while Connection keeps CRUD behind setup', async () => {
      let providers;
      const readback = ctx.plugin({ inject: ['youdubDomain'], async apply(scope) {
        await host.youdubContext(scope).plugin({ inject: ['catalog'], apply(domain) { providers = domain.catalog.listProviders(); } });
      } });
      try {
        await readback;
        assert.deepEqual(providers.map(p => p.id).sort(), ['demucs','qwen_forced_aligner','voxcpm','whisper','youdub.download','youdub.media','openai'].sort());
        assert.equal(providers.reduce((count, item) => count + item.operations.length, 0), 11);
        const translation = providers.find(provider => provider.id === 'openai');
        assert.equal(translation.available, false); assert.equal(translation.legacy, true);
        assert.deepEqual(translation.operations[0].node.ui.quickFields, ['targetLanguage']);
      } finally { await readback.dispose(); }
      for (const [method, path, body] of [
        ['GET', '/api/health'], ['GET', '/api/v2/catalog'], ['GET', '/api/v2/workflow-documents'],
        ['POST', '/api/v2/workflow-documents', { document: {} }],
        ['PUT', '/api/v2/workflow-documents/not-created', { document: {}, expectedRevision: 1 }],
        ['DELETE', '/api/v2/workflow-documents/not-created?expectedRevision=1'], ['POST', '/api/v2/tasks', {}],
      ]) {
        const result = await call(method, path, body);
        assert.equal(result.status, 503, `${method} ${path}`);
        assert.equal(result.body.error.code, 'ENVIRONMENT_NOT_READY');
        assert.equal(result.body.error.details.phase, 'models');
      }
    });
    await t.test('settings cannot change or use legacy credentials before full initialization', async () => {
      for (const body of [{ ui_language: 'en' }, { connection: { adapter: 'openai', base_url: 'http://invalid', api_key: 'never-sent' } }]) {
        const rejected = await call('PATCH', '/api/v2/settings', body);
        assert.equal(rejected.status, 503); assert.equal(rejected.body.error.code, 'ENVIRONMENT_NOT_READY');
      }
      assert.equal(preferences.ui_language, 'zh'); assert.equal(revision, 0);
    });
    await t.test('original examples HTML, script and video bytes are served unchanged', async () => {
      for (const [path, source] of [['index.html', 'apps/web/templates/examples.html'], ['player.js', 'site/player.js']]) {
        const response = await handlers.get(`/api/youdub/examples/${path}`).fetch(new Request(`http://localhost/api/youdub/examples/${path}?v=0.0.2`));
        assert.equal(await response.text(), await readFile(join(repo, source), 'utf8'));
      }
      const video = await handlers.get('/api/youdub/examples/assets/zoo-en.mp4').fetch(new Request('http://localhost/api/youdub/examples/assets/zoo-en.mp4', { headers: { range: 'bytes=0-63' } }));
      assert.equal(video.status, 206); assert.deepEqual(Buffer.from(await video.arrayBuffer()), (await readFile(join(repo, 'site/assets/zoo-en.mp4'))).subarray(0, 64));
    });
    await t.test('unsupported routes and malformed envelopes fail explicitly', async () => {
      assert.equal((await call('GET', '/api/v2/missing')).body.error.code, 'ENVIRONMENT_NOT_READY');
      const malformed = await handlers.get('/api/youdub/v2').fetch(new Request('http://localhost/api/youdub/v2', { method: 'POST', body: '{' })); assert.equal(malformed.status, 400);
      assert.equal((await call('GET', '/api/v2/extensions')).body.error.code, 'ENVIRONMENT_NOT_READY');
    });
  } finally { clearTimeout(watchdog); await plugin.dispose(); await services.dispose(); await jobs.dispose(); await sub.dispose(); await rm(data, { recursive: true, force: true }); }
});

test('missing explicit Python keeps official setup accessible and reports the original failure', { timeout: 10_000 }, async () => {
  const data = await mkdtemp(join(repo, '.native-setup-test-'));
  await mkdir(join(data, 'runtime'));
  const ctx = new Context(), handlers = new Map();
  const sub = ctx.plugin(LocalSubprocess); await sub;
  const jobs = ctx.plugin(LocalJobs); await jobs;
  const services = ctx.plugin({ name: 'test-setup-seams', apply(child) {
    child.reflect.provide('connection', { fetch: { register(route) { handlers.set(route.path, route); return () => handlers.delete(route.path); } } });
    for (const name of ['settings', 'credentials', 'llm', 'pluginManager']) child.reflect.provide(name, {});
  } }); await services;
  const previous = process.env.YOUDUB_PYTHON, python = join(data, 'missing/bin/python');
  process.env.YOUDUB_PYTHON = python;
  const plugin = ctx.plugin({ name: host.name, inject: host.inject, apply: child => host.apply(child, { python, modelsDir: join(data, 'models/whisper'), dataDir: data, installation: { get: () => null } }) });
  try {
    await plugin;
    const call = async (method, path, body) => {
      const response = await handlers.get('/api/youdub/v2').fetch(new Request('http://localhost/api/youdub/v2', { method: 'POST', body: JSON.stringify({ method, path, body }) }));
      return { status: response.status, body: await response.json() };
    };
    let setup;
    for (let attempt = 0; ; attempt++) {
      setup = await call('GET', '/api/setup');
      assert.equal(setup.status, 200);
      if (setup.body.phase === 'failed') break;
      assert(attempt < 100); await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(setup.body.error, `配置的 Python 不存在：${python}`);
    assert.equal(setup.body.canRetry, true);
    assert.equal(setup.body.environment[0].status, 'failed');
    const unavailable = await call('GET', '/api/v2/catalog');
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error.code, 'ENVIRONMENT_NOT_READY');
    const retried = await call('POST', '/api/setup', { action: 'retry' });
    assert.equal(retried.status, 200); assert.equal(retried.body.phase, 'environment');
  } finally {
    await plugin.dispose(); await services.dispose(); await jobs.dispose(); await sub.dispose();
    if (previous === undefined) delete process.env.YOUDUB_PYTHON; else process.env.YOUDUB_PYTHON = previous;
    await rm(data, { recursive: true, force: true });
  }
});
