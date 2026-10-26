import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { register } from 'tsx/esm/api';
import manifest from '../../../packages/builtin/src/setup-runtime.json' with { type: 'json' };
const source = register({ namespace: 'youdub-worker-media-test' });
const { default: YouDubWorker } = await source.import('../src/backend/worker.mjs', import.meta.url);
after(() => source.unregister());

test('a running worker uses the Windows archive installed after startup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-worker-media-'));
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(async () => {
    Object.defineProperty(process, 'platform', originalPlatform);
    await rm(root, { recursive: true, force: true });
  });
  const env = { YOUDUB_DESKTOP_DATA_DIR: root, PATH: 'system-tools' };
  const stdout = new PassThrough();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk.toString());
      stdout.write(JSON.stringify({ ...message, type: 'result', payload: message.payload.params.mediaEnvironment }) + '\n');
      callback();
    },
    final(callback) { stdout.end(); finish({ exitCode: 0 }); callback(); },
  });
  const worker = { config: { env }, request: YouDubWorker.prototype.request,
    ctx: { effect() {}, logger: { error: assert.fail }, subprocess: {
      spawn: () => ({ stdout, stdin, done, terminate() {}, waitForExit: async () => true }),
    } } };
  const request = () => YouDubWorker.prototype.request.call(worker, { command: 'python', args: [] });
  const sources = manifest.ffmpeg['win32-x64'];
  const bin = source => join(root, 'runtime', 'ffmpeg', source.directory, 'bin');
  assert.equal(request().env.FFMPEG_PATH, join(bin(sources[0]), 'ffmpeg.exe'));
  const bridge = await YouDubWorker.prototype.rpc.call(worker, { command: 'python', args: ['-m', 'backend.workers.bridge'] });
  t.after(() => bridge.close());
  assert.equal((await bridge.call('runtime.probe', { adapter: 'whisper' })).FFMPEG_PATH, join(bin(sources[0]), 'ffmpeg.exe'));
  const installed = bin(sources.at(-1));
  await mkdir(installed, { recursive: true });
  for (const name of ['ffmpeg.exe', 'ffprobe.exe']) await writeFile(join(installed, name), 'installed');
  const next = request();
  assert.equal(next.env.FFMPEG_PATH, join(installed, 'ffmpeg.exe'));
  assert.equal(next.env.FFPROBE_PATH, join(installed, 'ffprobe.exe'));
  assert.equal(next.env.PATH, [installed, 'system-tools'].join(delimiter));
  assert.deepEqual(await bridge.call('runtime.probe', { adapter: 'whisper' }), {
    FFMPEG_PATH: next.env.FFMPEG_PATH, FFPROBE_PATH: next.env.FFPROBE_PATH, PATH: next.env.PATH,
  });
  assert.deepEqual(env, { YOUDUB_DESKTOP_DATA_DIR: root, PATH: 'system-tools' });
});
