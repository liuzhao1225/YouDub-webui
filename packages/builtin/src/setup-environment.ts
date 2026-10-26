import { access, chmod, mkdir, readdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { Context } from 'cordis'
import { DownloadClient, fileSize, sourceName, type DownloadFile } from './setup-download.js'
import runtimeManifest from './setup-runtime.json' with { type: 'json' }
import { ffmpegDirectory } from './media-paths.js'
import { dependencyGroups, acceleratedGroups, type DependencyGroup } from './runtime-resources.js'
export { dependencyGroups, type DependencyGroup } from './runtime-resources.js'

export type SetupStage = 'pending' | 'running' | 'ready' | 'failed'
export interface EnvironmentStep { id: string; name: string; status: SetupStage; detail?: string; source?: string; phase?: 'downloading' | 'installing' | 'verifying'; progress?: { received: number; total: number; speed?: number }; activity?: string; log?: string; startedAt?: number; updatedAt?: number }
export interface EnvironmentConfig { root: string; repoRoot: string; python: string; privateEnvironment?: boolean }
export function platformTarget(platform = process.platform, arch = process.arch) {
  const targets: Record<string, string> = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-arm64': 'aarch64-unknown-linux-gnu', 'linux-x64': 'x86_64-unknown-linux-gnu', 'win32-x64': 'x86_64-pc-windows-msvc' }
  const target = targets[`${platform}-${arch}`]
  if (!target) throw new Error(`暂不支持 ${platform} / ${arch}，支持 macOS、Linux 的 arm64/x64 和 Windows x64。`)
  return target
}
export async function executable(name: string) {
  const suffixes = process.platform === 'win32' ? ['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')] : ['']
  for (const directory of (process.env.PATH || '').split(delimiter)) for (const suffix of suffixes) {
    const path = join(directory, name + suffix)
    try { await access(path, constants.X_OK); return path }
    catch (error: any) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error }
  }
  return undefined
}

export class EnvironmentSetup {
  steps: EnvironmentStep[] = [
    { id: 'python', name: 'Python 3.12', status: 'pending' },
    { id: 'dependencies', name: '基础运行依赖', status: 'pending' },
  ]
  private accelerationPlan?: { backend: string; detail: string; version: string; codec: string; index: string; variant: string; findLinks: string; installed: boolean; packages: string[]; prerequisites: string[] }
  private uvReady = false
  constructor(private ctx: Context, readonly config: EnvironmentConfig, private client: DownloadClient, private signal: AbortSignal) {}
  private run(command: string, args: string[], env?: Record<string, string>, cwd = this.config.repoRoot, onOutput?: (text: string, stream: 'stdout' | 'stderr') => void) {
    return this.ctx.youdubWorker.run({ command, args, cwd, env, signal: this.signal, onOutput })
  }
  private python(args: string[]) { return this.run(this.config.python, args) }
  async probe(action: string, groups: string[] = ['base']) {
    const result = await this.python(['-m', 'backend.workers.setup_probe', action, JSON.stringify(groups)])
    return JSON.parse(result.stdout.trim())
  }
  private source(id: string, source: string) {
    this.steps.find(step => step.id === id)!.source = source
    this.ctx.logger.info(`${id} 下载源：${source}`)
  }
  private line(step: EnvironmentStep, line: string) {
    const text = line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()
    if (!text || /^DEBUG Skipping file for /.test(text)) return
    step.updatedAt = Date.now()
    const log = (step.log || '').replace(/^\[较早日志已省略\]\n/, '') + `${new Date().toISOString()} ${text}\n`
    step.log = log.length > 64 * 1024 ? '[较早日志已省略]\n' + log.slice(-64 * 1024) : log
    const resolving = text.match(/^DEBUG (?:Searching for a compatible version of|Selecting:)\s+(.+)/)
    if (resolving) step.activity = `解析依赖：${resolving[1]}`.slice(0, 300)
    else if (!/^(?:Progress \d+ of \d+|DEBUG |TRACE )/.test(text)) step.activity = text.slice(0, 300)
  }
  private async download(id: string, asset: DownloadFile, path: string) {
    const step = this.steps.find(step => step.id === id)!
    step.phase = 'downloading'
    let previousBytes = 0, previousTime = Date.now(), loggedAt = 0
    await this.client.download({ ...asset, sourceGroup: id }, path, this.signal, received => {
      const now = Date.now(), elapsed = (now - previousTime) / 1000
      step.progress = { received, total: asset.size, speed: elapsed >= 0.5 ? (received - previousBytes) / elapsed : step.progress?.speed }
      step.updatedAt = now
      if (elapsed >= 0.5) { previousBytes = received; previousTime = now }
      if (received > 0 && (now - loggedAt >= 1000 || received === asset.size)) {
        this.line(step, `${asset.path}: ${(received / 1e6).toFixed(1)} / ${(asset.size / 1e6).toFixed(1)} MB (${Math.floor(received / asset.size * 100)}%)`)
        loggedAt = now
      }
    }, event => {
      step.source = sourceName(event.url)
      this.line(step, event.status === 'failed' ? event.error! : `${event.status === 'checking' ? '测试下载源' : '下载'}：${step.source} · ${asset.path}`)
    })
    this.line(step, `下载及校验完成：${asset.path}`)
    step.phase = 'verifying'; delete step.progress
  }
  private async installer(args: string[], source: string) {
    const step = this.steps.find(step => step.status === 'running')!
    step.source = source; step.phase = 'installing'; delete step.progress
    this.line(step, `$ python ${args.join(' ')}`)
    const buffers = { stdout: '', stderr: '' }
    const downloads = new Map<string, string>()
    let previousBytes = 0, previousTime = Date.now()
    const consume = (line: string) => {
      this.line(step, line)
      const raw = line.match(/^Progress (\d+) of (\d+)/)
      if (raw) {
        const received = Number(raw[1]), total = Number(raw[2]), now = Date.now(), elapsed = (now - previousTime) / 1000
        step.phase = 'downloading'; step.progress = { received, total, speed: elapsed > 0 ? Math.max(0, (received - previousBytes) / elapsed) : 0 }
        previousBytes = received; previousTime = now
      } else if (/Downloading|Downloaded|Prepared|Resolved|Installing|Installed|Building|Built/.test(line)) {
        step.phase = /Downloading/.test(line) ? 'downloading' : 'installing'; delete step.progress
        previousBytes = 0; previousTime = Date.now()
      }
      if (args[1] === 'uv') {
        const downloading = line.trim().match(/^Downloading (\S+)(.*)/)
        const downloaded = line.trim().match(/^Downloaded (\S+)/)
        if (downloading) downloads.set(downloading[1]!, downloading[1]! + downloading[2])
        if (downloaded) downloads.delete(downloaded[1]!)
        if (downloads.size) { step.phase = 'downloading'; step.activity = `下载中：${[...downloads.values()].slice(0, 2).join('、')}${downloads.size > 2 ? `（共 ${downloads.size} 个包）` : ''}` }
      }
    }
    try { return await this.run(this.config.python, args, {
      PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', PIP_EXTRA_INDEX_URL: '', PIP_FIND_LINKS: '',
      UV_NO_CONFIG: '1', UV_INDEX: '', UV_EXTRA_INDEX_URL: '', UV_FIND_LINKS: '', UV_HTTP_RETRIES: '0', UV_HTTP_TIMEOUT: '15',
      UV_PYTHON_DOWNLOADS: 'never', UV_CACHE_DIR: join(this.config.root, 'runtime', 'uv-cache'),
      ...(this.config.privateEnvironment ? { PIP_TARGET: '', PIP_PREFIX: '', PIP_ROOT: '', PIP_USER: '0' } : {}),
      HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*',
    }, this.config.repoRoot, (text, stream) => {
      buffers[stream] += text
      const lines = buffers[stream].split(/\r\n|\r|\n/); buffers[stream] = lines.pop()!
      for (const line of lines) consume(line)
    }) } finally { for (const buffer of Object.values(buffers)) if (buffer) consume(buffer) }
  }
  private async checkSource(url: string) {
    this.line(this.steps.find(step => step.status === 'running')!, `测试软件源：${url}`)
    const response = await fetch(url, { signal: AbortSignal.any([this.signal, AbortSignal.timeout(3000)]), headers: { Range: 'bytes=0-0' } })
    await response.body?.cancel()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
  }
  private async fromIndex(packageName: string, install: (index: string, wheels: string[]) => Promise<{ stdout: string; stderr: string }>, variant?: string) {
    const step = this.steps.find(step => step.status === 'running')!
    const failures: Error[] = []
    for (const index of ['https://pypi.org/simple/', 'https://mirrors.aliyun.com/pypi/simple/', 'https://pypi.tuna.tsinghua.edu.cn/simple/']) {
      const url = `${index}${packageName}/`
      const official = index === 'https://pypi.org/simple/'
      const wheels = variant ? official ? ['--index', `https://download.pytorch.org/whl/${variant}/`] : ['--find-links', `https://mirrors.aliyun.com/pytorch-wheels/${variant}/`] : []
      try {
        await this.checkSource(url)
        if (wheels.length) await this.checkSource(wheels[1]! + (official ? 'torch/' : ''))
      } catch (cause) {
        this.signal.throwIfAborted()
        const error = new Error(`软件源测试失败：${url} · ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
        failures.push(error); this.line(step, error.message); continue
      }
      this.line(step, `使用软件源：${index}${wheels.length ? ` · ${wheels[1]}` : ''}`)
      try { return await install(index, wheels) } catch (error) {
        this.signal.throwIfAborted()
        const detail = error instanceof Error ? error.message : String(error)
        if (!/failed to (?:download|fetch|connect)|error sending request|timed? out|timeout|connection|network|TLS|HTTP (?:status|403|404|429|5\d\d)/i.test(detail)) throw error
        this.line(step, `软件源下载失败：${index}\n${detail}`)
        failures.push(error instanceof Error ? error : new Error(detail)); continue
      }
    }
    throw new AggregateError(failures, failures.map(error => error.message).join('\n'))
  }
  private async pip(args: string[], variant?: string) {
    if (!this.uvReady) {
      const installed = await this.python(['-c', 'import importlib.util; print(int(importlib.util.find_spec("uv") is not None))'])
      if (installed.stdout.trim() !== '1') {
        await this.fromIndex('uv', index => this.installer(['-m', 'pip', 'install', '--disable-pip-version-check', '--retries', '0', '--progress-bar', 'raw', '--index-url', index, `uv==${runtimeManifest.uv.version}`], index))
      }
      const version = await this.python(['-m', 'uv', '--version'])
      this.line(this.steps.find(step => step.status === 'running')!, version.stdout.trim())
      this.uvReady = true
    }
    for (const url of args.filter(arg => arg.startsWith('https://'))) await this.checkSource(url)
    return this.fromIndex('packaging', (index, wheels) => this.installer(['-m', 'uv', 'pip', 'install', '--python', this.config.python, '--index-url', index, ...wheels, '--color', 'never', '--verbose', ...args], index), variant)
  }
  private async pythonEnvironment() {
    const environment = dirname(dirname(this.config.python))
    if (!await fileSize(this.config.python)) {
      if (this.config.privateEnvironment) {
        const managed = join(this.config.root, 'runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
        if (this.config.python !== managed) throw new Error(`配置的 Python 不存在：${this.config.python}`)
      } else if (process.env.YOUDUB_PYTHON?.trim()) throw new Error(`YOUDUB_PYTHON 不存在：${this.config.python}`)
      const windows = process.platform === 'win32'
      const asset = runtimeManifest.python[`${process.platform}-${process.arch}` as keyof typeof runtimeManifest.python]
      const folder = join(this.config.root, 'runtime', 'python')
      this.source('python', 'GitHub')
      await this.download('python', asset, join(folder, asset.path))
      // Pass only ASCII relative paths to Windows tar; cwd supports Unicode via CreateProcessW.
      const tar = windows ? join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe') : '/usr/bin/tar'
      await this.run(tar, ['-xf', asset.path], undefined, folder)
      const python = join(folder, 'python', windows ? 'python.exe' : 'bin/python3')
      await this.run(python, ['-m', 'venv', environment])
    }
    const result = await this.python(['-c', 'import sys; assert sys.version_info[:2] == (3, 12), "Python 3.12 is required"; print(sys.version.split()[0])'])
    return result.stdout.trim()
  }
  private async acceleration() {
    const plan = this.accelerationPlan = await this.probe('acceleration-plan')
    this.steps.find(step => step.id === 'acceleration')!.detail = plan.detail
    if (!plan.installed) {
      this.source('acceleration', plan.packages.length ? 'AMD 官方 / PyPI' : 'PyPI / PyTorch')
      if (plan.prerequisites.length) await this.pip(plan.prerequisites)
      await this.pip(plan.packages.length ? plan.packages : [`torch==${plan.version}${plan.variant ? '+' + plan.variant : ''}`, `torchaudio==${plan.version}${plan.variant ? '+' + plan.variant : ''}`], plan.findLinks ? plan.variant : undefined)
    }
    const status = await this.probe('acceleration')
    return status.backend === plan.backend ? status.detail : `${plan.detail}；${status.detail}`
  }
  private async dependencies(groups: DependencyGroup[]) {
    const { missing } = await this.probe('dependencies', groups)
    if (missing.length) {
      const options: string[] = []
      if (this.accelerationPlan) {
        const plan = this.accelerationPlan
        const constraints = join(this.config.root, 'runtime', 'torch-constraints.txt')
        await mkdir(dirname(constraints), { recursive: true })
        await writeFile(constraints, `torch==${plan.version}\ntorchaudio==${plan.version}\ntorchcodec==${plan.codec}\n`)
        options.push('-c', constraints)
      }
      this.source('dependencies', 'PyPI')
      await this.pip([...options, ...groups.flatMap(group => ['-r', join(this.config.repoRoot, 'backend', 'requirements', `${group}.txt`)])])
      const remaining = (await this.probe('dependencies', groups)).missing
      if (remaining.length) throw new Error(`依赖安装后仍未满足：${remaining.join(', ')}`)
    }
    if (groups.includes('demucs') && !await fileSize(join(this.config.repoRoot, 'submodule', 'demucs', 'demucs', '__init__.py'))) {
      await this.run('git', ['submodule', 'update', '--init', '--recursive', 'submodule/demucs'])
    }
  }
  private async media() {
    const directory = join(this.config.root, 'runtime', 'ffmpeg')
    const windows = process.platform === 'win32'
    let binDirectory = ffmpegDirectory(this.config.root)
    const paths: Record<string, string> = {}
    for (const name of ['ffmpeg', 'ffprobe']) {
      const envKey = name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
      let managed = join(binDirectory, name + (windows ? '.exe' : ''))
      const explicit = this.config.privateEnvironment ? undefined : process.env[envKey]?.trim()
      const path = explicit || (await fileSize(managed) ? managed : this.config.privateEnvironment ? undefined : await executable(name))
      if (path) {
        const args = name === 'ffmpeg' ? ['-hide_banner', '-filters'] : ['-version']
        const result = await this.run(path, args)
        const subtitles = name !== 'ffmpeg' || /\bsubtitles\b/.test(result.stdout)
        const shared = !windows || (await readdir(dirname(path))).some(file => /^av.*\.dll$/i.test(file))
        if (subtitles && shared) { paths[envKey] = path; continue }
        if (explicit) throw new Error(`${envKey} 需要支持 subtitles${windows ? ' 和共享 av*.dll' : ''}：${path}`)
        this.ctx.logger.info(`${path} 缺少所需能力，安装应用专用 FFmpeg。`)
      }
      await mkdir(directory, { recursive: true })
      this.source('ffmpeg', 'GitHub')
      const assets = runtimeManifest.ffmpeg[`${process.platform}-${process.arch}` as keyof typeof runtimeManifest.ffmpeg]
      if (windows) {
        const failures: Error[] = []
        for (const [index, asset] of runtimeManifest.ffmpeg['win32-x64'].entries()) {
          const archive = join(directory, asset.path)
          try { await this.download('ffmpeg', asset, archive) }
          catch (error) {
            if (!(error instanceof AggregateError)) throw error
            failures.push(error)
            if (index === runtimeManifest.ffmpeg['win32-x64'].length - 1) throw new AggregateError(failures, failures.map(error => error.message).join('\n'))
            this.line(this.steps.find(step => step.id === 'ffmpeg')!, error.message)
            continue
          }
          if (asset.path.endsWith('.zip')) await this.python(['-m', 'zipfile', '-e', archive, directory])
          else await this.python(['-c', 'import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2], filter="data")', archive, directory])
          binDirectory = join(directory, asset.directory, 'bin'); managed = join(binDirectory, name + '.exe')
          break
        }
      } else {
        const asset = assets.find(asset => asset.path.startsWith(name + '-'))!
        await this.download('ffmpeg', asset, managed)
        await chmod(managed, 0o700)
      }
      const result = await this.run(managed, name === 'ffmpeg' ? ['-hide_banner', '-filters'] : ['-version'])
      if (name === 'ffmpeg' && !/\bsubtitles\b/.test(result.stdout)) throw new Error(`下载的 FFmpeg 缺少 subtitles：${managed}`)
      paths[envKey] = managed
    }
    Object.assign(process.env, paths)
    // Whisper invokes `ffmpeg` by name, including when Finder supplied a minimal PATH.
    process.env.PATH = [...new Set([...Object.values(paths).map(path => dirname(path)), ...(process.env.PATH || '').split(delimiter)])].join(delimiter)
  }
  private async resources() {
    const data = join(this.config.root, 'nltk_data')
    process.env.NLTK_DATA = this.config.privateEnvironment ? data : [...new Set([data, ...(process.env.NLTK_DATA || '').split(delimiter).filter(Boolean)])].join(delimiter)
    if (!(await this.probe('punkt')).ready) {
      this.source('resources', 'NLTK 官方')
      const asset = runtimeManifest.punkt
      const folder = join(data, 'tokenizers')
      const archive = join(folder, asset.path)
      await this.download('resources', asset, archive)
      await this.python(['-m', 'zipfile', '-e', archive, folder])
    }
    if (!(await this.probe('punkt')).ready) throw new Error('Whisper 英文分句资源安装后未通过检查。')
  }
  private async restoreManagedPaths() {
    const windows = process.platform === 'win32'
    const directory = ffmpegDirectory(this.config.root)
    const directories: string[] = []
    for (const [name, key] of [['ffmpeg', 'FFMPEG_PATH'], ['ffprobe', 'FFPROBE_PATH']] as const) {
      const path = join(directory, name + (windows ? '.exe' : ''))
      if ((this.config.privateEnvironment || !process.env[key]?.trim()) && await fileSize(path)) {
        process.env[key] = path
        directories.push(directory)
      }
    }
    if (directories.length) process.env.PATH = [...new Set([...directories, ...(process.env.PATH || '').split(delimiter)])].join(delimiter)
    process.env.NLTK_DATA = this.config.privateEnvironment ? join(this.config.root, 'nltk_data') : [...new Set([join(this.config.root, 'nltk_data'), ...(process.env.NLTK_DATA || '').split(delimiter).filter(Boolean)])].join(delimiter)
  }
  async prepare(groups: DependencyGroup[] = ['base']) {
    platformTarget()
    if (groups.some(group => !dependencyGroups.includes(group))) throw new Error('Unknown dependency group.')
    await this.restoreManagedPaths()
    groups = [...new Set<DependencyGroup>(['base', ...groups])]
    const actions: Array<{ id: string; name: string; run: () => Promise<string | void> }> = [
      { id: 'python', name: 'Python 3.12', run: () => this.pythonEnvironment() },
      ...(groups.some(group => acceleratedGroups.includes(group)) ? [{ id: 'acceleration', name: 'GPU 与推理后端', run: () => this.acceleration() }] : []),
      { id: 'dependencies', name: groups.length === 1 ? '基础运行依赖' : '运行依赖', run: () => this.dependencies(groups) },
      ...(groups.includes('media') ? [{ id: 'ffmpeg', name: 'FFmpeg', run: () => this.media() }] : []),
      ...((groups.includes('whisper') || groups.includes('punkt')) ? [{ id: 'resources', name: '分句资源', run: () => this.resources() }] : []),
    ]
    this.steps = actions.map(({ id, name }) => ({ id, name, status: 'pending' }))
    for (const [index, action] of actions.entries()) {
      this.signal.throwIfAborted()
      const step = this.steps[index]!
      step.status = 'running'; step.phase = 'installing'; step.startedAt = Date.now(); delete step.detail
      this.line(step, `开始：${step.name}`)
      try { const detail = await action.run(); if (detail) step.detail = detail; this.line(step, `完成：${step.name}${detail ? ` · ${detail}` : ''}`); step.status = 'ready'; delete step.phase; delete step.progress }
      catch (error) { step.status = 'failed'; step.detail = error instanceof Error ? error.message : String(error); this.line(step, step.detail); throw error }
    }
  }
}
