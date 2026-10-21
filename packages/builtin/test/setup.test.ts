import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm, open } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { delimiter, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import Http from '../src/http.js'
import Setup from '../src/setup.js'
import { DownloadClient } from '../src/setup-download.js'
import { EnvironmentSetup } from '../src/setup-environment.js'
import { builtinResources } from '../src/runtime-resources.js'
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
  const ctx = { logger: { info() {} }, youdubWorker: { run: async ({ command, args, cwd }: { command: string; args: string[]; cwd: string }) => {
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
  const ctx = { logger: { info() {} }, youdubWorker: { run: async ({ command, args }: { command: string; args: string[] }) => {
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
  assert.equal(process.env.PATH, bin)
  assert.ok(!commands.some(args => ['acceleration', 'punkt', 'acceleration-plan'].includes(args[2] || '')))
  assert.ok(setup.steps.every(step => step.status === 'ready'))
})

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5000
  while (!predicate()) { if (Date.now() > deadline) throw new Error('setup test timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
}
test('private environment installs media tools inside YouDub instead of using machine paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-private-environment-'))
  const python = join(root, 'python')
  await writeFile(python, 'test Python')
  const previous = { ...process.env }
  const client = new DownloadClient(), commands: string[] = [], downloads: string[] = []
  t.after(async () => {
    await client.close()
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
    await rm(root, { recursive: true })
  })
  process.env.FFMPEG_PATH = '/machine/ffmpeg'
  process.env.FFPROBE_PATH = '/machine/ffprobe'
  process.env.NLTK_DATA = '/machine/nltk_data'
  const ctx = { logger: { info() {} }, youdubWorker: { run: async ({ command, args }: { command: string; args: string[] }) => {
    commands.push(command)
    assert.ok(!command.startsWith('/machine/'))
    return { stdout: args[1] === 'backend.workers.setup_probe' ? JSON.stringify(probeResult(args[2]!)) : args.includes('-filters') ? ' subtitles ' : '3.12.12', stderr: '' }
  } } } as unknown as Context
  t.mock.method(client, 'download', async (_asset: unknown, target: string) => {
    assert.ok(target.startsWith(join(root, 'runtime', 'ffmpeg')))
    downloads.push(target); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, 'test media executable')
  })
  await new EnvironmentSetup(ctx, { root, repoRoot: resolve('.'), python, privateEnvironment: true }, client, new AbortController().signal).prepare(['media'])
  assert.ok(downloads.length > 0)
  assert.ok(commands.some(command => command.startsWith(join(root, 'runtime', 'ffmpeg'))))
  assert.ok(process.env.FFMPEG_PATH!.startsWith(join(root, 'runtime', 'ffmpeg')))
  assert.ok(process.env.FFPROBE_PATH!.startsWith(join(root, 'runtime', 'ffmpeg')))
  assert.equal(process.env.NLTK_DATA, join(root, 'nltk_data'))
})
test('base restart restores existing managed FFmpeg and NLTK paths without installing inference dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-managed-resource-restart-'))
  const windows = process.platform === 'win32'
  const bin = join(root, 'runtime', 'ffmpeg', ...(windows ? ['ffmpeg-7.1.5-win32-x64-gpl-shared', 'bin'] : []))
  await mkdir(bin, { recursive: true })
  const python = join(root, 'python')
  await writeFile(python, 'test executable')
  for (const name of ['ffmpeg', 'ffprobe']) await writeFile(join(bin, name + (windows ? '.exe' : '')), 'managed executable')
  const previous = { ...process.env }
  t.after(async () => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
    await rm(root, { recursive: true })
  })
  delete process.env.FFMPEG_PATH; delete process.env.FFPROBE_PATH; delete process.env.NLTK_DATA
  const client = new DownloadClient()
  t.after(() => client.close())
  t.mock.method(client, 'download', async () => { throw new Error('Restart must not download resources') })
  const ctx = { logger: { info() {} }, youdubWorker: { run: async ({ command, args }: { command: string; args: string[] }) => {
    assert.equal(command, python)
    if (args[1] === 'backend.workers.setup_probe') {
      assert.deepEqual(JSON.parse(args[3]!), ['base'])
      return { stdout: JSON.stringify(probeResult(args[2]!)), stderr: '' }
    }
    return { stdout: '3.12.12', stderr: '' }
  } } } as unknown as Context
  await new EnvironmentSetup(ctx, { root, repoRoot: resolve('.'), python }, client, new AbortController().signal).prepare()
  assert.equal(process.env.FFMPEG_PATH, join(bin, 'ffmpeg' + (windows ? '.exe' : '')))
  assert.equal(process.env.FFPROBE_PATH, join(bin, 'ffprobe' + (windows ? '.exe' : '')))
  assert.equal(process.env.PATH?.split(delimiter)[0], bin)
  assert.equal(process.env.NLTK_DATA, join(root, 'nltk_data'))
})
test('private dependency installation clears machine pip destinations and installs only base before model selection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-private-pip-'))
  const python = join(root, 'python'), requests: any[] = []
  await writeFile(python, 'test Python')
  const previous = { ...process.env }, client = new DownloadClient()
  t.after(async () => {
    await client.close()
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
    await rm(root, { recursive: true })
  })
  Object.assign(process.env, { PIP_TARGET: '/machine/packages', PIP_PREFIX: '/machine/prefix', PIP_ROOT: '/machine/root', PIP_USER: '1' })
  let installed = false
  const ctx = { logger: { info() {} }, youdubWorker: { run: async (request: any) => {
    requests.push(request)
    const { args } = request
    if (args[1] === 'pip') {
      assert.equal(request.command, python)
      assert.equal(request.env.PIP_TARGET, ''); assert.equal(request.env.PIP_PREFIX, '')
      assert.equal(request.env.PIP_ROOT, ''); assert.equal(request.env.PIP_USER, '0')
      assert.equal(args.filter((arg: string) => arg.endsWith('.txt')).length, 1)
      assert.ok(args.includes(join(resolve('.'), 'backend/requirements/base.txt')))
      installed = true
      return { stdout: '', stderr: '' }
    }
    if (args[1] === 'backend.workers.setup_probe') {
      assert.equal(args[2], 'dependencies')
      assert.deepEqual(JSON.parse(args[3]), ['base'])
      return { stdout: JSON.stringify({ missing: installed ? [] : ['pydantic'] }), stderr: '' }
    }
    return { stdout: '3.12.15', stderr: '' }
  } } } as unknown as Context
  t.mock.method(client, 'download', async () => { throw new Error('Base test must not download Python, media or models') })
  await new EnvironmentSetup(ctx, { root, repoRoot: resolve('.'), python, privateEnvironment: true }, client, new AbortController().signal).prepare(['base'])
  assert.equal(installed, true)
  assert.ok(!requests.some(request => ['acceleration-plan', 'acceleration', 'models'].includes(request.args[2])))
})
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
    owner.reflect.provide('youdubWorker', { run: async () => { throw new Error('unexpected process') } })
    owner.reflect.provide('loader', {})
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root: tmpdir(), repoRoot: resolve('.'), python: '/unused/python', version: '0.0.6', entries: [] })
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

test('base setup opens the workbench before optional packages/models and prepares only the selected subtitle dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-first-run-'))
  const python = join(root, 'python')
  await writeFile(python, 'test executable')
  if (process.platform === 'win32') await writeFile(join(root, 'avcodec-test.dll'), 'test shared library')
  const previous = { FFMPEG_PATH: process.env.FFMPEG_PATH, FFPROBE_PATH: process.env.FFPROBE_PATH, YOUDUB_DESKTOP_DATA_DIR: process.env.YOUDUB_DESKTOP_DATA_DIR, NLTK_DATA: process.env.NLTK_DATA }
  process.env.FFMPEG_PATH = python; process.env.FFPROBE_PATH = python
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started: string[] = [], created: string[] = [], probes: { action: string; groups: string[] }[] = []
  let modelReady = false, installed = false
  const refreshed: string[] = []
  t.mock.method(DownloadClient.prototype, 'download', async function(file: any, target: string, signal: AbortSignal, progress: (value: number) => void) {
    started.push(target); progress(1)
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      gate.then(() => { signal.removeEventListener('abort', abort); signal.aborted ? reject(signal.reason) : resolve() })
    })
    await mkdir(join(target, '..'), { recursive: true })
    const fileHandle = await open(target, 'w')
    await fileHandle.truncate(file.size); await fileHandle.close()
    modelReady = true
    progress(file.size)
  })
  const ctx = new Context()
  const app = await ctx.plugin(async function setupTest(owner) {
    owner.reflect.provide('youdubWorker', { run: async ({ args }: { args: string[] }) => {
      if (args[1] === 'pip') {
        assert.ok(args.includes(join(resolve('.'), 'backend', 'requirements', 'whisper.txt')))
        assert.ok(!args.some(arg => /voxcpm|demucs|qwen/.test(arg)))
        installed = true
      }
      if (args[1] === 'backend.workers.setup_probe') {
        const action = args[2]!, groups: string[] = JSON.parse(args[3]!)
        probes.push({ action, groups })
        assert.ok(!groups.some(group => ['voxcpm', 'demucs', 'qwen_forced_aligner'].includes(group)), 'subtitle preparation must not inspect TTS, separation or alignment')
        const missing = groups.includes('whisper') && !installed ? ['openai-whisper'] : []
        const value = action === 'resources' ? { missing, media: true, punkt: true, demucsSource: true } :
          action === 'dependencies' ? { missing } :
          action === 'models' ? { whisper: { models: modelReady ? [{ id: 'tiny' }] : [], unavailable_reason: 'Whisper tiny 未安装' } } : probeResult(action)
        return { stderr: '', stdout: JSON.stringify(value) }
      }
      return { stderr: '', stdout: args.includes('-filters') ? ' ... subtitles ... ' : '3.12.12\n' }
    } })
    owner.reflect.provide('catalog', { listProviders: () => ['youdub.media', 'whisper', 'openai'].map(id => ({ id, resources: builtinResources(id), available: true, models: id === 'whisper' && modelReady ? [{ id: 'tiny' }] : [] })), provider: (id: string) => ({ probe: async () => { refreshed.push(id); return { available: true } } }) })
    owner.reflect.provide('loader', { create: async (entry: any) => { created.push(entry.id) }, await: async () => {}, *entries() {} })
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root, repoRoot: resolve('.'), python, version: '0.0.6', entries: [{ id: 'runtime', name: 'runtime' }] })
  })
  t.after(async () => {
    release(); await app.dispose()
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await rm(root, { recursive: true })
  })
  ctx.emit('app/ready')
  await waitFor(() => ctx.setup.snapshot().phase === 'ready')
  const url = ctx.http.address + '/api/setup'
  const state = await (await fetch(url)).json() as any
  assert.equal(state.version, '0.0.6')
  assert.equal(typeof state.osVersion, 'string')
  assert.equal(state.homeDir, homedir())
  assert.deepEqual(state.models, [])
  assert.deepEqual(created, ['runtime'])
  assert.deepEqual(started, [])
  assert.ok(probes.every(item => item.groups.length === 1 && item.groups[0] === 'base'))
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 403)
  assert.equal((await fetch(url, { headers: { Origin: 'https://untrusted.example' } })).status, 403)
  const action = (action: string, id?: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-YouDub-Setup': state.token }, body: JSON.stringify({ action, id }) })
  assert.equal((await action('pause', 'unknown')).status, 422)
  const selections = [{ providerId: 'youdub.media' }, { providerId: 'whisper', model: 'tiny' }, { providerId: 'openai' }]
  const missing = await ctx.setup.checkResources(selections)
  assert.equal(missing.status, 'missing')
  assert.deepEqual(started, [], 'checking a graph must not start downloads')
  assert.deepEqual(missing.models.map(model => model.id), ['whisper'])
  assert.equal((await ctx.setup.prepareResources(selections)).status, 'preparing')
  await waitFor(() => started.length === 1)
  const other = await ctx.setup.checkResources([{ providerId: 'openai' }])
  assert.equal(other.activePreparation?.status, 'preparing')
  assert.ok(other.activePreparation?.selections.some(item => item.providerId === 'whisper'))
  await assert.rejects(ctx.setup.prepareResources([{ providerId: 'openai' }]), { code: 'RESOURCE_PREPARATION_BUSY' })
  assert.equal(started.length, 1, 'changing the selected graph must not start or replace an active preparation')
  const paused = await (await action('pause', 'whisper')).json() as any
  assert.equal(paused.resources.models.find((model: any) => model.id === 'whisper').status, 'paused')
  assert.equal((await action('resume', 'whisper')).status, 200)
  await waitFor(() => started.length === 2)
  release()
  await waitFor(() => ctx.setup.snapshot().resources?.status === 'ready')
  assert.deepEqual(created, ['runtime'])
  assert.ok(refreshed.includes('whisper'))
  assert.ok(refreshed.every(id => ['youdub.media', 'whisper', 'openai'].includes(id)))
  assert.ok((await ctx.setup.checkResources(selections)).requirements.every(item => item.ready))
  assert.equal(ctx.setup.snapshot().phase, 'ready')
  const unsupported = [{ providerId: 'whisper', model: 'small' }]
  await assert.rejects(ctx.setup.prepareResources(unsupported), { code: 'MANUAL_RESOURCE_REQUIRED' })
  assert.equal(started.length, 2, 'a missing non-default model must not silently download tiny')
})

test('installed remote dependencies do not make an unconfigured service ready', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-remote-configuration-'))
  const previous = process.env.YOUDUB_DESKTOP_DATA_DIR
  let configured = false
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(this: EnvironmentSetup) { this.steps = [] })
  t.mock.method(EnvironmentSetup.prototype, 'probe', async () => ({ missing: [], media: true, punkt: true, demucsSource: true }))
  const ctx = new Context()
  const app = await ctx.plugin(async function remoteConfiguration(owner) {
    owner.reflect.provide('youdubWorker', { run: async () => { throw new Error('Checking configuration must not execute a model') } })
    owner.reflect.provide('loader', { create: async () => {}, await: async () => {}, *entries() {} })
    owner.reflect.provide('catalog', {
      provider: () => ({ probe: async () => ({}) }),
      listProviders: () => [{ id: 'openai', resources: builtinResources('openai'), execution: 'remote', available: configured, unavailableReason: configured ? undefined : 'Provider connection is not configured.', models: configured ? [{ id: 'qwen-test' }] : [] }],
    })
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root, repoRoot: resolve('.'), python: '/unused/python', version: '0.0.7', entries: [] })
  })
  t.after(async () => {
    await app.dispose(); await rm(root, { recursive: true })
    if (previous === undefined) delete process.env.YOUDUB_DESKTOP_DATA_DIR
    else process.env.YOUDUB_DESKTOP_DATA_DIR = previous
  })
  ctx.emit('app/ready')
  await waitFor(() => ctx.setup.snapshot().phase === 'ready')
  const missing = await ctx.setup.checkResources([{ providerId: 'openai' }])
  assert.equal(missing.status, 'missing')
  assert.equal(missing.requirements[0]?.automatic, false)
  assert.equal(missing.requirements[0]?.configurationRequired, true)
  assert.equal(missing.requirements[0]?.reason, 'Provider connection is not configured.')
  await assert.rejects(ctx.setup.prepareResources([{ providerId: 'openai' }]), { code: 'MANUAL_RESOURCE_REQUIRED' })
  configured = true
  assert.equal((await ctx.setup.checkResources([{ providerId: 'openai' }])).status, 'missing')
  assert.equal((await ctx.setup.checkResources([{ providerId: 'openai', model: 'unknown' }])).status, 'missing')
  assert.equal((await ctx.setup.checkResources([{ providerId: 'openai', model: 'qwen-test' }])).status, 'ready')
})

test('configuration checks and explicit retries persist recovery after dependency preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-resource-configuration-recovery-'))
  const previous = process.env.YOUDUB_DESKTOP_DATA_DIR
  let installed = false, configured = false, installations = 0
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(this: EnvironmentSetup, groups: string[] = ['base']) {
    this.steps = []
    if (groups.includes('openai')) { installed = true; installations++ }
  })
  t.mock.method(EnvironmentSetup.prototype, 'probe', async () => ({ missing: installed ? [] : ['openai'], media: true, punkt: true, demucsSource: true }))
  const ctx = new Context(), errors: unknown[] = []
  const logging = ctx.logger.exporter({ export(entry) { if (entry.type === 'error') errors.push(...entry.args) } })
  const app = await ctx.plugin(async function configurationRecovery(owner) {
    owner.reflect.provide('youdubWorker', { run: async () => { throw new Error('Configuration checks must not execute a model') } })
    owner.reflect.provide('loader', { create: async () => {}, await: async () => {}, *entries() {} })
    owner.reflect.provide('catalog', {
      provider: () => ({ probe: async () => ({}) }),
      listProviders: () => [{ id: 'openai', resources: builtinResources('openai'), execution: 'remote', available: installed && configured, unavailableReason: installed ? configured ? undefined : 'Provider connection is not configured.' : 'OpenAI SDK is missing.', models: installed && configured ? [{ id: 'qwen-test' }] : [] }],
    })
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root, repoRoot: resolve('.'), python: '/unused/python', version: '0.0.7', entries: [] })
  })
  t.after(async () => {
    await app.dispose(); await logging(); await rm(root, { recursive: true })
    if (previous === undefined) delete process.env.YOUDUB_DESKTOP_DATA_DIR
    else process.env.YOUDUB_DESKTOP_DATA_DIR = previous
  })
  ctx.emit('app/ready')
  await waitFor(() => ctx.setup.snapshot().phase === 'ready')
  const selections = [{ providerId: 'openai', model: 'qwen-test' }]
  const original = 'openai: Provider connection is not configured.'
  for (const action of ['check', 'prepare'] as const) {
    installed = false; configured = false
    const before = installations
    assert.equal((await ctx.setup.checkResources(selections)).requirements[0]?.automatic, true)
    await ctx.setup.prepareResources(selections)
    await waitFor(() => ctx.setup.snapshot().resources?.status === 'failed')
    const failed = ctx.setup.snapshot().resources!
    assert.equal(failed.error, original)
    assert.equal(failed.requirements[0]?.configurationRequired, true)
    assert.equal(failed.requirements[0]?.automatic, false)
    assert.deepEqual(failed.requirements[0]?.missingPackages, [])
    assert.equal(failed.requirements[0]?.reason, 'Provider connection is not configured.')
    assert.equal((await ctx.setup.checkResources(selections)).error, original)
    assert.equal(ctx.setup.snapshot().resources?.status, 'failed')
    assert.equal(installations, before + 1, 'checking the failed configuration must not reinstall dependencies')
    configured = true
    const recovered = action === 'check' ? await ctx.setup.checkResources(selections) : await ctx.setup.prepareResources(selections)
    assert.equal(recovered.status, 'ready')
    assert.equal(ctx.setup.snapshot().resources?.status, 'ready')
    assert.equal(ctx.setup.snapshot().resources?.error, undefined)
    assert.equal((await ctx.setup.checkResources(selections)).status, 'ready')
    assert.equal(installations, before + 1, 'explicit recovery must not repeat successful installation')
  }
  assert.equal(errors.filter(error => error instanceof Error && error.message === original).length, 2)
})

test('failed selected model download retains the error and leaves the workbench ready', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-resource-failure-'))
  const previous = process.env.YOUDUB_DESKTOP_DATA_DIR
  const original = new Error('ModelScope connection interrupted after 123 bytes')
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(this: EnvironmentSetup) { this.steps = [] })
  t.mock.method(EnvironmentSetup.prototype, 'probe', async (action: string) => {
    if (action === 'resources') return { missing: [], media: true, punkt: true, demucsSource: true }
    if (action === 'models') return { whisper: { models: [], unavailable_reason: 'Whisper tiny 未安装' } }
    return { ready: true }
  })
  t.mock.method(DownloadClient.prototype, 'download', async () => { throw original })
  const ctx = new Context()
  const errors: unknown[] = []
  const logging = ctx.logger.exporter({ export(entry) { if (entry.type === 'error') errors.push(...entry.args) } })
  const app = await ctx.plugin(async function resourceFailure(owner) {
    owner.reflect.provide('catalog', { provider: () => ({ probe: async () => ({}) }), listProviders: () => [{ id: 'whisper', resources: builtinResources('whisper'), available: false, models: [] }] })
    owner.reflect.provide('youdubWorker', { run: async () => { throw new Error('unexpected process') } })
    owner.reflect.provide('loader', { create: async () => {}, await: async () => {}, *entries() {} })
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root, repoRoot: resolve('.'), python: '/unused/python', version: '0.0.7', entries: [] })
  })
  t.after(async () => {
    await app.dispose(); await logging(); await rm(root, { recursive: true })
    if (previous === undefined) delete process.env.YOUDUB_DESKTOP_DATA_DIR
    else process.env.YOUDUB_DESKTOP_DATA_DIR = previous
  })
  ctx.emit('app/ready')
  await waitFor(() => ctx.setup.snapshot().phase === 'ready')
  const selections = [{ providerId: 'whisper', model: 'tiny' }]
  await ctx.setup.prepareResources(selections)
  await waitFor(() => ctx.setup.snapshot().resources?.status === 'failed')
  const failed = await ctx.setup.checkResources(selections)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.models[0]?.error, original.message)
  assert.match(failed.error!, /ModelScope connection interrupted after 123 bytes/)
  assert.ok(errors.includes(original))
  assert.equal(ctx.setup.snapshot().phase, 'ready')
})
