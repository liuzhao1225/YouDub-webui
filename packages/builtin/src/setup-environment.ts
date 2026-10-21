import { access, chmod, mkdir, readdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { Context } from 'cordis'
import { DownloadClient, fileSize } from './setup-download.js'
import runtimeManifest from './setup-runtime.json' with { type: 'json' }
import { dependencyGroups, acceleratedGroups, type DependencyGroup } from './runtime-resources.js'
export { dependencyGroups, type DependencyGroup } from './runtime-resources.js'

export type SetupStage = 'pending' | 'running' | 'ready' | 'failed'
export interface EnvironmentStep { id: string; name: string; status: SetupStage; detail?: string; source?: string }
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
  constructor(private ctx: Context, readonly config: EnvironmentConfig, private client: DownloadClient, private signal: AbortSignal) {}
  private run(command: string, args: string[], env?: Record<string, string>, cwd = this.config.repoRoot) {
    return this.ctx.youdubWorker.run({ command, args, cwd, env, signal: this.signal })
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
  private pip(args: string[]) {
    // Ignore machine-specific index/proxy settings for first-run dependency downloads.
    return this.run(this.config.python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--retries', '0',
      '--prefer-binary', '--index-url', 'https://mirrors.aliyun.com/pypi/simple/', ...args], {
      PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null', PIP_EXTRA_INDEX_URL: '', PIP_FIND_LINKS: '',
      ...(this.config.privateEnvironment ? { PIP_TARGET: '', PIP_PREFIX: '', PIP_ROOT: '', PIP_USER: '0' } : {}),
      HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*', no_proxy: '*',
    })
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
      this.source('python', '阿里 npmmirror')
      await this.client.download(asset, join(folder, asset.path), this.signal, () => {})
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
      this.source('acceleration', plan.packages.length ? 'AMD 官方（此版本暂无国内镜像）＋阿里 PyPI' : '阿里 PyPI / PyTorch')
      if (plan.prerequisites.length) await this.pip(plan.prerequisites)
      await this.pip([...(plan.findLinks ? ['--find-links', plan.findLinks] : []),
        ...(plan.packages.length ? plan.packages : [`torch==${plan.version}${plan.variant ? '+' + plan.variant : ''}`, `torchaudio==${plan.version}${plan.variant ? '+' + plan.variant : ''}`])])
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
      this.source('dependencies', '阿里 PyPI')
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
    const binDirectory = windows ? join(directory, 'ffmpeg-7.1.5-win32-x64-gpl-shared', 'bin') : directory
    const paths: Record<string, string> = {}
    for (const name of ['ffmpeg', 'ffprobe']) {
      const envKey = name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
      const managed = join(binDirectory, name + (windows ? '.exe' : ''))
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
      this.source('ffmpeg', '阿里 npmmirror')
      const assets = runtimeManifest.ffmpeg[`${process.platform}-${process.arch}` as keyof typeof runtimeManifest.ffmpeg]
      if (windows) {
        const asset = assets[0]!
        const archive = join(directory, asset.path)
        await this.client.download(asset, archive, this.signal, () => {})
        await this.python(['-c', 'import sys, tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2], filter="data")', archive, directory])
      } else {
        const asset = assets.find(asset => asset.path.startsWith(name + '-'))!
        await this.client.download(asset, managed, this.signal, () => {})
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
      this.source('resources', 'ModelScope 阿里云 OSS')
      const asset = runtimeManifest.punkt
      const folder = join(data, 'tokenizers')
      const archive = join(folder, asset.path)
      await this.client.download(asset, archive, this.signal, () => {})
      await this.python(['-m', 'zipfile', '-e', archive, folder])
    }
    if (!(await this.probe('punkt')).ready) throw new Error('Whisper 英文分句资源安装后未通过检查。')
  }
  private async restoreManagedPaths() {
    const windows = process.platform === 'win32'
    const directory = join(this.config.root, 'runtime', 'ffmpeg', ...(windows ? ['ffmpeg-7.1.5-win32-x64-gpl-shared', 'bin'] : []))
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
      ...(groups.includes('whisper') ? [{ id: 'resources', name: '分句资源', run: () => this.resources() }] : []),
    ]
    this.steps = actions.map(({ id, name }) => ({ id, name, status: 'pending' }))
    for (const [index, action] of actions.entries()) {
      this.signal.throwIfAborted()
      const step = this.steps[index]!
      step.status = 'running'; delete step.detail
      try { const detail = await action.run(); if (detail) step.detail = detail; step.status = 'ready' }
      catch (error) { step.status = 'failed'; step.detail = error instanceof Error ? error.message : String(error); throw error }
    }
  }
}
