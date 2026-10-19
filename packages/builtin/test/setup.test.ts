import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { delimiter, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Http from '../src/http.js'
import Setup from '../src/setup.js'
import { DownloadClient } from '../src/setup-download.js'
import { EnvironmentSetup } from '../src/setup-environment.js'
import { runtimePaths } from '../../../apps/host/src/paths.js'

function probeResult(action: string) {
  if (action === 'dependencies') return { missing: [] }
  if (action === 'acceleration-plan') return { backend: 'cpu', installed: true, version: '2.8.0', codec: '0.7.0', packages: [], prerequisites: [], detail: 'CPU' }
  if (action === 'acceleration') return { backend: 'cpu', detail: 'CPU（运算检查通过）' }
  return { ready: true }
}

test('first-run skips Windows Store Python aliases and extracts Python in Unicode paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-unicode-archive-'))
  const source = join(root, 'source'), fixture = join(root, 'python.tar.gz')
  const data = join(root, "用户 空格 # % ' [测试]")
  const windows = process.platform === 'win32'
  const relativePython = windows ? 'python/python.exe' : 'python/bin/python3'
  await mkdir(join(source, 'python', 'bin'), { recursive: true })
  await writeFile(join(source, relativePython), 'archive fixture, never executed')
  const tar = windows ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : '/usr/bin/tar'
  const run = promisify(execFile)
  await run(tar, ['-czf', fixture, 'python'], { cwd: source, windowsHide: true })
  const previous = { PATH: process.env.PATH, YOUDUB_PYTHON: process.env.YOUDUB_PYTHON }
  const client = new DownloadClient()
  t.after(async () => {
    await client.close()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await rm(root, { recursive: true })
  })
  const aliases = join(root, 'Microsoft', 'WindowsApps')
  await mkdir(aliases, { recursive: true })
  await writeFile(join(aliases, 'python.EXE'), 'Microsoft Store placeholder, never execute', { mode: 0o700 })
  process.env.PATH = [aliases, previous.PATH].filter(Boolean).join(delimiter)
  delete process.env.YOUDUB_PYTHON
  const stop = new Error('Stop before creating venv')
  let extracted = false
  const ctx = { logger: { info() {} }, process: { run: async ({ command, args, cwd }: { command: string; args: string[]; cwd: string }) => {
    if (command === tar) {
      assert.equal(cwd, join(data, 'runtime', 'python'))
      assert.ok(args.every(arg => /^[\x00-\x7f]*$/.test(arg)))
      return run(command, args, { cwd, windowsHide: true })
    }
    assert.equal(command, join(data, 'runtime', 'python', relativePython))
    assert.equal(await readFile(command, 'utf8'), 'archive fixture, never executed')
    extracted = true
    throw stop
  } } } as unknown as Context
  t.mock.method(client, 'download', async (asset: { url: string }, destination: string) => {
    assert.ok(asset.url.startsWith('https://registry.npmmirror.com/-/binary/python-build-standalone/'))
    await mkdir(join(data, 'runtime', 'python'), { recursive: true }); await cp(fixture, destination)
  })
  const setup = new EnvironmentSetup(ctx, { root: data, repoRoot: resolve('.'), python: join(data, 'runtime', 'venv', windows ? 'Scripts/python.exe' : 'bin/python') }, client, new AbortController().signal)
  await assert.rejects(setup.prepare(), error => error === stop)
  assert.equal(extracted, true)
})

test('desktop Python stays in its data directory even when a system Python is on PATH', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-desktop-environment-'))
  const environment = join(root, 'runtime/venv')
  const bin = join(root, 'python-bin')
  const media = join(root, 'media-bin')
  await mkdir(bin); await mkdir(media)
  const windows = process.platform === 'win32'
  const executable = join(bin, windows ? 'python.exe' : 'python3.12')
  await writeFile(executable, 'test executable', { mode: 0o700 })
  await writeFile(join(media, 'ffmpeg'), 'test executable', { mode: 0o700 })
  if (windows) await writeFile(join(media, 'avcodec-test.dll'), 'test shared library')
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
  assert.equal(python, join(environment, windows ? 'Scripts/python.exe' : 'bin/python'))
  const commands: string[][] = []
  const ctx = { logger: { info() {} }, process: { run: async ({ command, args }: { command: string; args: string[] }) => {
    commands.push(args)
    if (args[1] === 'venv') {
      assert.equal(command, join(root, 'runtime', 'python', 'python', windows ? 'python.exe' : 'bin/python3'))
      await mkdir(join(args[2]!, windows ? 'Scripts' : 'bin'), { recursive: true })
      await writeFile(python, 'test executable')
    }
    return { stderr: '', stdout: args[1] === 'backend.workers.setup_probe' ? JSON.stringify(probeResult(args[2]!)) : args.includes('-filters') ? ' ... subtitles ... ' : '3.12\n' }
  } } } as unknown as Context
  const client = new DownloadClient()
  t.after(() => client.close())
  t.mock.method(client, 'download', async () => {})
  const setup = new EnvironmentSetup(ctx, { root, repoRoot: resolve('.'), python }, client, new AbortController().signal)
  await setup.prepare()
  assert.ok(commands.some(args => args[1] === 'venv' && args[2] === environment))
  assert.equal(process.env.PATH?.split(delimiter)[0], media)
  assert.ok(setup.steps.every(step => step.status === 'ready'))
})

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate()) { if (Date.now() > deadline) throw new Error('setup test timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
}
for (const unrelatedFailure of [false, true]) test(`closing first-run setup ${unrelatedFailure ? 'preserves unrelated errors' : 'cancels preparation without reporting a failure'}`, async t => {
  const previous = process.env.YOUDUB_DESKTOP_DATA_DIR
  const originalError = new Error('dependency download failed')
  let started = false
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(this: any) {
    started = true
    await new Promise<void>((_resolve, reject) => this.signal.addEventListener('abort', () => {
      reject(unrelatedFailure ? originalError : new Error('download interrupted', { cause: this.signal.reason }))
    }, { once: true }))
  })
  const ctx = new Context()
  const errors: unknown[] = []
  const logging = ctx.logger.exporter({ export(entry) { if (entry.type === 'error') errors.push(...entry.args) } })
  const app = await ctx.plugin(async function shutdownTest(owner) {
    owner.reflect.provide('process', { run: async () => { throw new Error('unexpected process') } })
    owner.reflect.provide('loader', {})
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root: tmpdir(), repoRoot: resolve('.'), python: '/unused/python', entries: [] })
  })
  t.after(async () => {
    await app.dispose(); await logging()
    if (previous === undefined) delete process.env.YOUDUB_DESKTOP_DATA_DIR
    else process.env.YOUDUB_DESKTOP_DATA_DIR = previous
  })
  ctx.emit('app/ready')
  await waitFor(() => started)
  await app.dispose()
  assert.deepEqual(errors, unrelatedFailure ? [originalError] : [])
})

test('first-run API runs four models concurrently, pauses independently, guards mutations and starts runtime only after completion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-first-run-'))
  const python = join(root, 'python')
  await writeFile(python, 'test executable')
  if (process.platform === 'win32') await writeFile(join(root, 'avcodec-test.dll'), 'test shared library')
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
    owner.reflect.provide('process', { run: async ({ args }: { args: string[] }) => ({ stderr: '', stdout: args[1] === 'backend.workers.setup_probe' ? JSON.stringify(probeResult(args[2]!)) : args.includes('-filters') ? ' ... subtitles ... ' : '3.12.12\n' }) })
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
