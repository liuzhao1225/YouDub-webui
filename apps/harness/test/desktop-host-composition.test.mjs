import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDevelopmentProject } from '../dist/desktop/development-project.mjs';
import { prepareYouDubProfile } from '../prepare-profile.mjs';

const app = resolve(import.meta.dirname, '..'), root = resolve(app, '../..');
const source = join(root, '.cache/harness/source-build');
const require = createRequire(join(app, 'package.json'));

test('real Desktop Host boots the product Loader, protects requests and reports first-run work without sessions or Office', { timeout: 60_000 }, async t => {
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
  const version = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).version;
  const pnpm = join(app, 'node_modules/pnpm/bin/pnpm.mjs');
  const runtime = prepareDevelopmentProject({
    projectDir: join(directory, 'runtime'), cliDir: join(source, 'apps/cli'),
    hostDir: join(source, 'apps/desktop-host'), dependencyDir: join(source, 'node_modules/.pnpm/node_modules'),
    release: { schemaVersion: 1, version, hostProtocolVersion: 4, nodeVersion: process.versions.node,
      pnpmVersion: JSON.parse(await readFile(join(app, 'node_modules/pnpm/package.json'), 'utf8')).version },
    target: `${process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`,
  });
  await symlink(dirname(require.resolve('busboy/package.json')), join(runtime, 'node_modules/busboy'), 'dir');
  const plugin = join(runtime, 'youdub-plugin');
  await mkdir(join(plugin, 'dist'), { recursive: true });
  for (const file of ['package.json', 'cordis.patch.yml', 'dist/host.mjs', 'dist/client.js']) await cp(join(app, file), join(plugin, file));
  await symlink(join(runtime, 'node_modules'), join(plugin, 'node_modules'), 'dir');
  await prepareYouDubProfile(profile, plugin, runtime, { command: process.execPath, args: [pnpm] });
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'youdub-subtitles', config: {
    python: process.env.YOUDUB_TEST_PYTHON || join(root, '.venv/bin/python'),
    modelsDir: join(home, 'youdub/models/whisper'), dataDir: join(home, 'youdub'),
  } }]) + '\n');

  // Use the actual compiled Host and its IPC contract. No fake framework services,
  // account, Agent, model downloads or second application runtime are supplied.
  child = fork(join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),
    [runtime, profile, join(directory, 'absent-office-runtime'), pnpm, join(app, 'dist/desktop/scripts/node-bin')], {
      cwd: runtime, execArgv: ['--expose-internals'], silent: true,
      env: { ...process.env, DSH_HOME: home, YOUDUB_MEDIA_ROOT: root, YOUDUB_NODE_PATH: process.execPath },
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
  assert.notEqual(setup.phase, 'ready', 'Missing models must not pass first-run preparation');
  assert.notEqual(setup.phase, 'failed', setup.error);
  assert.deepEqual(setup.models.map(model => model.id), ['whisper', 'voxcpm', 'demucs', 'qwen']);

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
