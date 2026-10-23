import { test, beforeEach, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { delimiter, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { DownloadClient } from '../src/setup-download.js'
import { EnvironmentSetup } from '../src/setup-environment.js'

// Installer processes are faked in these unit tests; source connectivity is tested separately.
const actualFetch = globalThis.fetch
beforeEach(t => { (t as TestContext).mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => String(url).startsWith('https://') ? new Response('') : actualFetch(url, init)) })

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
  t.mock.method(client, 'download', async (asset: { url: string; mirrors?: string[] }, destination: string) => {
    assert.ok(asset.url.startsWith('https://github.com/astral-sh/python-build-standalone/releases/download/'))
    assert.ok(asset.mirrors?.[0]?.startsWith('https://registry.npmmirror.com/-/binary/python-build-standalone/'))
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
  const python = join(environment, windows ? 'Scripts/python.exe' : 'bin/python')
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
    if (args.some((arg: string) => arg.startsWith('uv=='))) return { stdout: 'Installed uv', stderr: '' }
    if ((args[1] === 'pip' || args[1] === 'uv' && args[2] === 'pip')) {
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
test('uv bootstrap and dependency installation expose live output and select the mirror only after a failed official probe', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-live-install-')), python = join(root, 'python')
  await writeFile(python, 'test Python')
  const client = new DownloadClient(), requests: any[] = [], indexes: string[] = []
  t.after(async () => { await client.close(); await rm(root, { recursive: true }) })
  t.mock.method(globalThis, 'fetch', async (url: any) => { indexes.push(String(url)); return new Response('', { status: String(url).startsWith('https://pypi.org/') ? 503 : 200 }) })
  let installed = false, release: (() => void) | undefined
  const ctx = { logger: { info() {} }, youdubWorker: { run: async (request: any) => {
    requests.push(request)
    const args: string[] = request.args
    if (args.some(arg => arg.startsWith('uv=='))) {
      request.onOutput('Downloading uv-0.13.0.whl\nProgress 20 of ', 'stdout')
      request.onOutput('100\n', 'stdout')
      await new Promise<void>(resolve => { release = resolve })
      return { stdout: 'installed uv', stderr: '' }
    }
    if (args[1] === 'uv' && args[2] === 'pip') {
      request.onOutput('Downloading torch (100MiB)\nDownloading sympy (6MiB)\nDownloaded sympy\n', 'stderr')
      assert.equal(setup.steps.find(step => step.status === 'running')!.phase, 'downloading')
      assert.equal(setup.steps.find(step => step.status === 'running')!.activity, '下载中：torch (100MiB)')
      installed = true; request.onOutput('Downloaded torch\nResolved 3 packages\nInstalled 3 packages\n', 'stderr')
    }
    if (args[1] === 'backend.workers.setup_probe') return { stdout: JSON.stringify({ missing: installed ? [] : ['pydantic'] }), stderr: '' }
    return { stdout: args[0] === '-c' && args[1]!.includes('find_spec') ? '0' : args[1] === 'uv' ? 'uv 0.13.0' : '3.12.15', stderr: '' }
  } } } as unknown as Context
  const setup = new EnvironmentSetup(ctx, { root, repoRoot: resolve('.'), python }, client, new AbortController().signal)
  const pending = setup.prepare(['base'])
  await waitFor(() => Boolean(release))
  const step = setup.steps.find(step => step.status === 'running')!
  assert.equal(step.phase, 'downloading'); assert.equal(step.progress?.received, 20); assert.equal(step.progress?.total, 100)
  assert.ok(step.startedAt && step.updatedAt); assert.match(step.activity!, /Downloading uv/)
  assert.match(step.log!, /503/); assert.match(step.log!, /Progress 20 of 100/)
  release!(); await pending
  const uv = requests.find(request => request.args[1] === 'uv' && request.args[2] === 'pip')
  assert.equal(uv.args[uv.args.indexOf('--python') + 1], python)
  assert.equal(uv.args[uv.args.indexOf('--index-url') + 1], 'https://mirrors.aliyun.com/pypi/simple/')
  assert.equal(uv.env.UV_CACHE_DIR, join(root, 'runtime', 'uv-cache'))
  assert.deepEqual(indexes.slice(0, 2), ['https://pypi.org/simple/uv/', 'https://mirrors.aliyun.com/pypi/simple/uv/'])
  assert.match(step.log!, /Installed 3 packages/)
})

for (const failure of ['probe', 'download', 'resolver']) test(`Torch ${failure} keeps official-first selection and visible failures`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-torch-source-')), python = join(root, 'python')
  await writeFile(python, 'test Python')
  const client = new DownloadClient(), urls: string[] = [], installs: string[][] = []
  t.after(async () => { await client.close(); await rm(root, { recursive: true }) })
  t.mock.method(globalThis, 'fetch', async (url: any) => {
    urls.push(String(url))
    return new Response('', { status: failure === 'probe' && String(url).includes('download.pytorch.org') ? 503 : 200 })
  })
  const original = new Error(failure === 'download' ? 'Failed to download torch: HTTP status 503' : 'No solution found: incompatible dependencies')
  const ctx = { logger: { info() {} }, youdubWorker: { run: async ({ args }: any) => {
    if (args[1] === 'uv' && args[2] === 'pip') {
      installs.push(args)
      if (args.includes('--index')) throw original
    }
    if (args[1] === 'backend.workers.setup_probe') return { stdout: JSON.stringify(args[2] === 'acceleration-plan'
      ? { backend: 'cpu', installed: false, variant: 'cpu', version: '2.8.0', codec: '0.7.0', findLinks: 'https://download.pytorch.org/whl/cpu/', prerequisites: [], packages: [], detail: 'CPU' }
      : args[2] === 'acceleration' ? { backend: 'cpu', detail: 'CPU verified' } : { missing: [], ready: true }), stderr: '' }
    return { stdout: args[0] === '-c' && args[1].includes('find_spec') ? '1' : '3.12.15', stderr: '' }
  } } } as unknown as Context
  const setup = new EnvironmentSetup(ctx, { root, repoRoot: resolve('.'), python }, client, new AbortController().signal)
  const prepare = setup.prepare(['whisper'])
  if (failure === 'resolver') {
    await assert.rejects(prepare, error => error === original)
    assert.ok(!urls.some(url => url.includes('aliyun')))
  } else {
    await prepare
    assert.ok(urls.indexOf('https://download.pytorch.org/whl/cpu/torch/') < urls.indexOf('https://mirrors.aliyun.com/pytorch-wheels/cpu/'))
    assert.ok(installs.at(-1)!.includes('https://mirrors.aliyun.com/pytorch-wheels/cpu/'))
    assert.match(setup.steps.find(step => step.id === 'acceleration')!.log!, /503/)
    if (failure === 'download') assert.ok(installs[0]!.includes('https://download.pytorch.org/whl/cpu/'))
  }
})
