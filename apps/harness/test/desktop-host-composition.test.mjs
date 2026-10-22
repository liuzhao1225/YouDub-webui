import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareYouDubProfile } from '../prepare-profile.mjs';
import { prepareSourceDevelopment } from '../prepare-source-development.mjs';
import { desktopNodeEnvironment } from '../../../vendor/deepseek-harness/source/apps/desktop/src/node-environment.ts';

const app = resolve(import.meta.dirname, '..'), root = resolve(app, '../..');

for (const skipSetup of [false, true]) test(`real Desktop Host boots the product Loader with setup ${skipSetup ? 'explicitly skipped for UI tests' : 'required by default'}`, { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youdub-host-composition-'));
  let child, exited;
  t.after(async () => {
    try {
      if (!child) return;
      if (child.connected) child.send({ type: 'shutdown' });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
      try {
        const [code, signal] = await exited;
        assert.equal(signal, null, `Host required forced shutdown: ${stderr}`);
        assert.equal(code, 0, stderr);
      } finally { clearTimeout(timeout); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const home = join(directory, 'home'), profile = join(home, 'profiles/desktop');
  const { project: runtime, pluginRoot: plugin, node, pnpm, nodeBin } = await prepareSourceDevelopment({ projectDirectory: join(directory, 'runtime') });
  const inventory = JSON.parse(await readFile(join(runtime, 'youdub-source-runtime.json'), 'utf8'));
  for (const name of ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-deepseek-account', '@deepseek-ai/dsh-acp-app',
    '@deepseek-ai/dsh-skill-office', '@deepseek-ai/dsh-tool-workspace-dependencies', '@deepseek-ai/dsh-experimental-agent-team-profile']) {
    assert(!inventory.sourcePackages.some(pkg => pkg.name === name), `Unrelated runtime dependency: ${name}`);
    await assert.rejects(access(join(runtime, 'node_modules', name)), { code: 'ENOENT' });
  }
  assert(node.startsWith(join(app, 'node_modules/electron') + sep), 'Node must belong to this application Electron installation');
  assert.equal(pnpm, join(app, 'node_modules/pnpm/bin/pnpm.mjs'));
  await prepareYouDubProfile(profile, plugin, runtime, { command: node, args: ['--expose-internals', pnpm], env: desktopNodeEnvironment(node, nodeBin, process.env) });
  if (!skipSetup) await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'youdub-subtitles', config: {
    python: process.env.YOUDUB_TEST_PYTHON || join(root, '.venv/bin/python'),
    modelsDir: join(home, 'youdub/models/whisper'), dataDir: join(home, 'youdub'),
  } }]) + '\n');

  // Use the actual compiled Host and its IPC contract. No fake framework services,
  // account, Agent, model downloads or second application runtime are supplied.
  child = fork(join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),
    [runtime, profile, pnpm, nodeBin], {
      cwd: profile, execPath: node, execArgv: ['--expose-internals'], silent: true,
      env: { ...desktopNodeEnvironment(node, undefined, process.env), DSH_HOME: home, YOUDUB_MEDIA_ROOT: root, YOUDUB_NODE_PATH: node, YOUDUB_TEST_SKIP_SETUP: skipSetup ? '1' : '0',
        ...(skipSetup ? { YOUDUB_TEST_PYTHON: process.env.YOUDUB_TEST_PYTHON || join(root, '.venv/bin/python') } : {}) },
    });
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16_384); });
  child.stdout.resume(); // Launch URLs contain a process token; never print them in test output.
  exited = once(child, 'exit');
  const messages = [], pending = new Set();
  const waitFor = predicate => {
    const existing = messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(listener); reject(new Error(`Host IPC timed out: ${stderr}`)); }, 30_000);
      const listener = message => {
        if (message.type !== 'fatal' && !predicate(message)) return;
        clearTimeout(timer); pending.delete(listener);
        if (message.type === 'fatal') reject(new Error(message.diagnostic || message.message)); else resolve(message);
      };
      pending.add(listener);
    });
  };
  child.on('message', message => { messages.push(message); for (const listener of pending) listener(message); });

  const ready = await waitFor(message => message.type === 'ready');
  const graph = ready.injections.find(row => row.kind === 'global' && row.name === '__DSH_BOOT__').value;
  const ids = graph.entries.map(entry => entry.id);
  const appInfo = ready.injections.find(row => row.kind === 'global' && row.name === '__YOUDUB_APP_INFO__').value;
  assert.equal(appInfo.version, JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
  assert.equal(appInfo.platform, process.platform);
  assert.equal(appInfo.arch, process.arch);
  assert.equal(typeof appInfo.osVersion, 'string');
  assert.deepEqual(Object.keys(appInfo).sort(), ['arch', 'osVersion', 'platform', 'version']);
  assert.equal(ready.injections.some(row => row.kind === 'global' && row.name === '__YOUDUB_TEST_SKIP_SETUP__' && row.value === true), skipSetup, stderr);
  for (const id of ['@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-file-upload', '@deepseek-ai/dsh-client-ui-conversation']) assert(!ids.includes(id), id);
  for (const id of ['@youdub/harness-subtitles', '@deepseek-ai/dsh-client-ui-settings-models',
    '@deepseek-ai/dsh-client-ui-layout']) assert(ids.includes(id), id);
  assert(!messages.some(message => message.type === 'platform-session'));
  await assert.rejects(access(join(home, 'dsh-runtimes')), { code: 'ENOENT' });

  const origin = new URL(ready.url).origin, api = `${origin}/api/youdub/v2`;
  const body = JSON.stringify({ method: 'GET', path: '/api/setup' });
  assert.equal((await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
  const exchange = await fetch(ready.url, { redirect: 'manual' });
  assert.equal(exchange.status, 303);
  const cookie = exchange.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const response = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body });
  assert.equal(response.status, 200);
  const setup = await response.json();
  assert.equal(setup.phase, skipSetup ? 'skipped' : 'installation');
  assert.equal(setup.environment.length, 0);
  if (!skipSetup) await assert.rejects(access(join(home, 'youdub')), { code: 'ENOENT' });
  assert.notEqual(setup.phase, 'ready', 'Missing models must not pass first-run preparation');
  assert.notEqual(setup.phase, 'failed', setup.error);
  assert.deepEqual(setup.models.map(model => model.id), skipSetup ? [] : ['whisper', 'voxcpm', 'demucs', 'qwen']);
  if (skipSetup) {
    assert.equal(setup.testMode, true);
    await assert.rejects(access(join(home, 'youdub/runtime')), { code: 'ENOENT' });
    await assert.rejects(access(join(home, 'youdub/models')), { code: 'ENOENT' });
    const tasks = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ method: 'GET', path: '/api/v2/tasks' }) });
    assert.equal(tasks.status, 200, await tasks.text());
  }

  child.send({ type: 'quit-inspection', requestId: 1 });
  const inspection = await waitFor(message => message.type === 'quit-inspection' && message.requestId === 1);
  assert.equal(inspection.error, undefined);
  assert.equal(typeof inspection.activeTasks, 'boolean');
  assert.equal(inspection.scheduledTasks, false);
  child.send({ type: 'update-tasks', requestId: 2, action: 'inspect' });
  const update = await waitFor(message => message.type === 'update-tasks' && message.requestId === 2);
  assert.equal(update.error, undefined);
  assert.equal(typeof update.active, 'boolean');
});
