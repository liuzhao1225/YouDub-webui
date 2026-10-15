import { access, chmod, mkdir, readdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type { Context } from 'cordis'
import { DownloadClient, fileSize } from './setup-download.js'

export type SetupStage = 'pending' | 'running' | 'ready' | 'failed'
export interface EnvironmentStep { id: string; name: string; status: SetupStage; detail?: string }
export interface EnvironmentConfig { root: string; repoRoot: string; python: string }
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
    { id: 'acceleration', name: 'GPU 与推理后端', status: 'pending' },
    { id: 'dependencies', name: '运行依赖', status: 'pending' },
    { id: 'ffmpeg', name: 'FFmpeg', status: 'pending' },
    { id: 'resources', name: '分句资源', status: 'pending' },
  ]
  private accelerationPlan?: { backend: string; detail: string; version: string; codec: string; index: string; installed: boolean; packages: string[]; prerequisites: string[] }
  constructor(private ctx: Context, readonly config: EnvironmentConfig, private client: DownloadClient, private signal: AbortSignal) {}
  private run(command: string, args: string[], env?: Record<string, string>) {
    return this.ctx.process.run({ command, args, cwd: this.config.repoRoot, env, signal: this.signal })
  }
  private python(args: string[]) { return this.run(this.config.python, args) }
  async probe(action: string) {
    const result = await this.python(['-m', 'backend.workers.setup_probe', action])
    return JSON.parse(result.stdout.trim())
  }
  private async releaseAsset(repo: string, tag: string, name: string) {
    const release = await this.client.json(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, this.signal)
    const asset = release.assets?.find((item: any) => item.name === name)
    if (!asset?.digest?.startsWith('sha256:')) throw new Error(`下载清单缺少 SHA-256：${repo}/${tag}/${name}`)
    return { path: name, url: asset.browser_download_url as string, size: asset.size as number, sha256: asset.digest.slice(7) as string }
  }
  private async pythonEnvironment() {
    const environment = dirname(dirname(this.config.python))
    if (!await fileSize(this.config.python)) {
      if (process.env.YOUDUB_PYTHON?.trim()) throw new Error(`YOUDUB_PYTHON 不存在：${this.config.python}`)
      const systemPython = await executable(process.platform === 'win32' ? 'python' : 'python3.12')
      let compatible = false
      if (systemPython) {
        const version = await this.run(systemPython, ['-c', 'import sys; print(".".join(map(str, sys.version_info[:2])))'])
        compatible = version.stdout.trim() === '3.12'
        if (!compatible) this.ctx.logger.info(`检测到 Python ${version.stdout.trim()}，准备应用专用 Python 3.12。`)
      }
      if (systemPython && compatible) {
        await this.run(systemPython, ['-m', 'venv', environment])
      } else {
        const target = platformTarget()
        const folder = join(this.config.root, 'runtime', 'uv')
        const windows = process.platform === 'win32'
        const name = `uv-${target}.${windows ? 'zip' : 'tar.gz'}`
        const asset = await this.releaseAsset('astral-sh/uv', '0.13.0', name)
        const archive = join(folder, name)
        await this.client.download(asset, archive, this.signal, () => {})
        if (windows) {
          // Windows tar can lose non-ASCII paths on an English system locale.
          const shell = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
          await this.run(shell, ['-NoProfile', '-NonInteractive', '-Command',
            "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead($env:YOUDUB_ARCHIVE); try { $entry = $zip.GetEntry('uv.exe'); if (!$entry) { throw 'UV archive is missing uv.exe' }; [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, [IO.Path]::Combine($env:YOUDUB_EXTRACT_DIR, 'uv.exe'), $true) } finally { $zip.Dispose() }"],
          { YOUDUB_ARCHIVE: archive, YOUDUB_EXTRACT_DIR: folder })
        } else await this.run('tar', ['-xf', archive, '-C', folder])
        const uv = windows ? join(folder, 'uv.exe') : join(folder, `uv-${target}`, 'uv')
        const env = { UV_PYTHON_INSTALL_DIR: join(this.config.root, 'runtime', 'python'), UV_PYTHON_BIN_DIR: join(this.config.root, 'runtime', 'bin'), UV_NO_MODIFY_PATH: '1', UV_INDEX_URL: 'https://mirrors.aliyun.com/pypi/simple/' }
        await this.run(uv, ['python', 'install', '3.12'], env)
        await this.run(uv, ['venv', '--python', '3.12', '--seed', environment], env)
      }
    }
    const result = await this.python(['-c', 'import sys; assert sys.version_info[:2] == (3, 12), "Python 3.12 is required"; print(sys.version.split()[0])'])
    return result.stdout.trim()
  }
  private async acceleration() {
    const plan = this.accelerationPlan = await this.probe('acceleration-plan')
    this.steps.find(step => step.id === 'acceleration')!.detail = plan.detail
    if (!plan.installed) {
      if (plan.prerequisites.length) await this.python(['-m', 'pip', 'install', '--disable-pip-version-check', ...plan.prerequisites])
      await this.python(['-m', 'pip', 'install', '--disable-pip-version-check', '--prefer-binary', '--index-url', plan.index,
        ...(plan.packages.length ? plan.packages : [`torch==${plan.version}`, `torchaudio==${plan.version}`])])
    }
    const status = await this.probe('acceleration')
    return status.backend === plan.backend ? status.detail : `${plan.detail}；${status.detail}`
  }
  private async dependencies() {
    const { missing } = await this.probe('dependencies')
    if (missing.length) {
      const plan = this.accelerationPlan!
      const constraints = join(this.config.root, 'runtime', 'torch-constraints.txt')
      await mkdir(dirname(constraints), { recursive: true })
      await writeFile(constraints, `torch==${plan.version}\ntorchaudio==${plan.version}\ntorchcodec==${plan.codec}\n`)
      const args = ['-m', 'pip', 'install', '--disable-pip-version-check', '--prefer-binary', '--index-url', 'https://mirrors.aliyun.com/pypi/simple/', '-c', constraints, '-r', join(this.config.repoRoot, 'requirements.txt')]
      try { await this.python(args) }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/No matching distribution found|Could not find a version that satisfies/.test(message)) throw error
        // Only a missing mirror package permits this explicit, recorded mirror change.
        this.ctx.logger.warn(message)
        this.steps.find(step => step.id === 'dependencies')!.detail = '阿里云缺少依赖，改用清华源安装'
        args[args.indexOf('https://mirrors.aliyun.com/pypi/simple/')] = 'https://pypi.tuna.tsinghua.edu.cn/simple/'
        await this.python(args)
      }
      const remaining = (await this.probe('dependencies')).missing
      if (remaining.length) throw new Error(`依赖安装后仍未满足：${remaining.join(', ')}`)
    }
    if (!await fileSize(join(this.config.repoRoot, 'submodule', 'demucs', 'demucs', '__init__.py'))) {
      await this.run('git', ['submodule', 'update', '--init', '--recursive', 'submodule/demucs'])
    }
  }
  private async media() {
    const directory = join(this.config.root, 'runtime', 'ffmpeg')
    const windows = process.platform === 'win32'
    const binDirectory = windows ? join(directory, 'ffmpeg-master-latest-win64-gpl-shared', 'bin') : directory
    const paths: Record<string, string> = {}
    for (const name of ['ffmpeg', 'ffprobe']) {
      const envKey = name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
      const managed = join(binDirectory, name + (windows ? '.exe' : ''))
      const explicit = process.env[envKey]?.trim()
      const path = explicit || (await fileSize(managed) ? managed : await executable(name))
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
      if (windows) {
        const asset = await this.releaseAsset('BtbN/FFmpeg-Builds', 'latest', 'ffmpeg-master-latest-win64-gpl-shared.zip')
        const archive = join(directory, asset.path)
        await this.client.download(asset, archive, this.signal, () => {})
        await this.python(['-m', 'zipfile', '-e', archive, directory])
      } else {
        const asset = await this.releaseAsset('eugeneware/ffmpeg-static', 'b6.1.1', `${name}-${process.platform}-${process.arch}`)
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
    process.env.NLTK_DATA = [data, process.env.NLTK_DATA].filter(Boolean).join(delimiter)
    if (!(await this.probe('punkt')).ready) {
      const asset = {
        path: 'punkt_tab.zip', size: 4319076,
        sha256: 'e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106',
        url: 'https://raw.githubusercontent.com/nltk/nltk_data/4f15a3d89eefe9748ec1c05be495d91289197155/packages/tokenizers/punkt_tab.zip',
      }
      const folder = join(data, 'tokenizers')
      const archive = join(folder, asset.path)
      await this.client.download(asset, archive, this.signal, () => {})
      await this.python(['-m', 'zipfile', '-e', archive, folder])
    }
    if (!(await this.probe('punkt')).ready) throw new Error('Whisper 英文分句资源安装后未通过检查。')
  }
  async prepare() {
    platformTarget()
    const actions = [() => this.pythonEnvironment(), () => this.acceleration(), () => this.dependencies(), () => this.media(), () => this.resources()]
    for (const [index, action] of actions.entries()) {
      this.signal.throwIfAborted()
      const step = this.steps[index]!
      step.status = 'running'; delete step.detail
      try { const detail = await action(); if (detail) step.detail = detail; step.status = 'ready' }
      catch (error) { step.status = 'failed'; step.detail = error instanceof Error ? error.message : String(error); throw error }
    }
  }
}
