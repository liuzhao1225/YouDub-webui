import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Http from '../src/http.js'
import Setup from '../src/setup.js'
import { DownloadClient } from '../src/setup-download.js'
import { EnvironmentSetup } from '../src/setup-environment.js'
import { runtimePaths } from '../../../apps/host/src/paths.js'

test('desktop Python is created in the writable data directory without modifying the application bundle', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-desktop-environment-'))
  const environment = join(root, 'runtime/venv')
  const bin = join(root, 'python-bin')
  const media = join(root, 'media-bin')
  await mkdir(bin); await mkdir(media)
  const executable = join(bin, 'python3.12')
  await writeFile(executable, 'test executable', { mode: 0o700 })
  await writeFile(join(media, 'ffmpeg'), 'test executable', { mode: 0o700 })
  const previous = { ...process.env }
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
    await rm(root, { recursive: true })
  })
  process.env.PATH = bin
  delete process.env.YOUDUB_PYTHON
  process.env.YOUDUB_PYTHON_ENV_DIR = environment
  process.env.FFMPEG_PATH = join(media, 'ffmpeg')
  process.env.FFPROBE_PATH = join(media, 'ffmpeg')
  const { python } = runtimePaths(root)
  assert.equal(python, join(environment, 'bin/python'))
  const commands: string[][] = []
  const ctx = { process: { run: async ({ args }: { args: string[] }) => {
    commands.push(args)
    if (args[1] === 'venv') {
      await mkdir(join(args[2]!, 'bin'), { recursive: true })
      await writeFile(python, 'test executable')
    }
    return { stderr: '', stdout: args[1] === 'backend.workers.setup_probe' ? JSON.stringify(args[2] === 'dependencies' ? { missing: [] } : { ready: true }) : args.includes('-filters') ? ' ... subtitles ... ' : '3.12\n' }
  } } } as unknown as Context
  const setup = new EnvironmentSetup(ctx, { root, repoRoot: resolve('.'), python }, new DownloadClient(), new AbortController().signal)
  await setup.prepare()
  assert.ok(commands.some(args => args[1] === 'venv' && args[2] === environment))
  assert.equal(process.env.PATH?.split(':')[0], media)
  assert.ok(setup.steps.every(step => step.status === 'ready'))
})

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate()) { if (Date.now() > deadline) throw new Error('setup test timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
}
test('first-run API runs four models concurrently, pauses independently, guards mutations and starts runtime only after completion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-first-run-'))
  const python = join(root, 'python')
  await writeFile(python, 'test executable')
  const previous = { FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH, YOUDUB_DESKTOP_DATA_DIR: process.env.YOUDUB_DESKTOP_DATA_DIR, NLTK_DATA: process.env.NLTK_DATA }
  process.env.FFMPEG_PATH = python; process.env.FFPROBE_PATH = python
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started: string[] = [], created: string[] = []
  t.mock.method(DownloadClient.prototype, 'download', async function(file: any, target: string, signal: AbortSignal, progress: (value: number) => void) {
    started.push(target); progress(1)
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      gate.then(() => { signal.removeEventListener('abort', abort); signal.aborted ? reject(signal.reason) : resolve() })
    })
    progress(file.size)
  })
  const ctx = new Context()
  const app = await ctx.plugin(async function setupTest(owner) {
    owner.reflect.provide('process', { run: async ({ args }: { args: string[] }) => ({ stderr: '', stdout: args[1] === 'backend.workers.setup_probe' ? JSON.stringify(args[2] === 'dependencies' ? { missing: [] } : { ready: true }) : args.includes('-filters') ? ' ... subtitles ... ' : '3.12.12\n' }) })
    owner.reflect.provide('loader', { create: async (entry: any) => { created.push(entry.id) }, await: async () => {}, *entries() {} })
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root, repoRoot: resolve('.'), python, entries: [{ id: 'runtime', name: 'runtime' }] })
  })
  t.after(async () => {
    release(); await app.dispose()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await rm(root, { recursive: true })
  })
  ctx.emit('app/ready')
  await waitFor(() => started.length === 4)
  const url = ctx.http.address + '/api/setup'
  const state = await (await fetch(url)).json() as any
  assert.equal(state.models.filter((model: any) => model.status === 'downloading').length, 4)
  assert.deepEqual(created, [])
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403)
  const action = (action: string, id?: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-YouDub-Setup': state.token }, body: JSON.stringify({ action, id }) })
  assert.equal((await action('pause', 'unknown')).status, 422)
  const paused = await (await action('pause', 'whisper')).json() as any
  assert.equal(paused.models.find((model: any) => model.id === 'whisper').status, 'paused')
  assert.equal(paused.models.filter((model: any) => model.status === 'downloading').length, 3)
  assert.equal((await action('resume', 'whisper')).status, 200)
  await waitFor(() => started.length === 5)
  release()
  await waitFor(() => ctx.setup.snapshot().phase === 'ready')
  assert.deepEqual(created, ['runtime'])
  assert.equal(ctx.setup.snapshot().models.length, 4)
  assert.ok(ctx.setup.snapshot().models.every(model => model.status === 'ready'))
  assert.equal((await action('resume')).status, 409)
})
