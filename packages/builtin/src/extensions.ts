import { Service, type Context } from 'cordis'
import { readFile, writeFile, mkdir, cp, realpath, lstat, symlink, rm, readdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, resolve, relative, join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { AppError } from '@youdub/sdk'

interface ClientModule { id: string; version: string; access: 'public' | 'authenticated'; url: string; css?: string[]; config?: object }
interface PythonEntry { entry: string; requirements?: string; provider: Record<string, any>; options?: object; runtimeAdapter?: string }
interface Installed { id: string; version: string; integrity: string; source: string; commit?: string; directory: string; host?: string; python?: PythonEntry; client?: { entry: string; css?: string[]; access?: 'public' | 'authenticated' }; enabled: boolean; config: object }
export interface ExtensionsConfig { root: string; repoRoot: string; builtinClientManifest?: string; managementOnly?: boolean }
export interface InstallRequest { source: string; ref?: string; enabled?: boolean; config?: object }
declare module 'cordis' { interface Context { extensions: ExtensionsService } }
const compatible = (value: unknown) => ['1.0.0', '^1.0.0', '~1.0.0', '1', '1.x'].includes(String(value))
const cleanId = (id: unknown): id is string => typeof id === 'string' && /^[a-z][a-z0-9.-]{1,100}$/.test(id)
const mime: Record<string, string> = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
export default class ExtensionsService extends Service {
  static inject = ['process', 'tasks']
  private installed: Installed[] = []
  private active = new Set<string>()
  private bootEnabled = new Set<string>()
  private builtin: { modules: ClientModule[]; publicAssets?: string[] } = { modules: [] }
  private busy = false
  constructor(ctx: Context, private config: ExtensionsConfig) { super(ctx, 'extensions') }
  async [Service.init]() {
    await mkdir(this.config.root, { recursive: true, mode: 0o700 })
    try { this.installed = JSON.parse(await readFile(join(this.config.root, 'installed.json'), 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!this.config.managementOnly) for (const item of this.installed.filter(item => item.enabled)) await this.verifyPackage(item)
    this.bootEnabled = new Set(this.config.managementOnly ? [] : this.installed.filter(item => item.enabled).map(item => item.id))
    for (const item of this.installed) if (this.bootEnabled.has(item.id) && !item.host && !item.python) this.active.add(item.id)
    if (this.config.builtinClientManifest) this.builtin = JSON.parse(await readFile(this.config.builtinClientManifest, 'utf8'))
  }
  list() { return { items: this.installed.map(item => ({ id: item.id, version: item.version, source: item.source, commit: item.commit, integrity: item.integrity, installed: true, enabled: item.enabled, active: this.active.has(item.id), restartRequired: item.enabled !== this.active.has(item.id) })) } }
  hostEntries() {
    return this.installed.filter(item => this.bootEnabled.has(item.id) && (item.host || item.python)).map(item => {
      const identity = { id: item.id, version: item.version, integrity: item.integrity }
      if (item.python) return {
        id: item.id, name: pathToFileURL(resolve(this.config.repoRoot, 'packages/builtin/src/python-provider.ts')).href,
        inject: item.python.runtimeAdapter ? ['store'] : undefined,
        config: { ...item.config, descriptor: { ...item.python.provider, pluginId: item.id, pluginVersion: item.version, integrity: item.integrity }, command: join(item.directory, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'), args: ['-B', resolve(item.directory, item.python.entry)], cwd: item.directory, options: item.python.options || {}, runtimeAdapter: item.python.runtimeAdapter, $plugin: identity },
      }
      return { id: item.id, name: pathToFileURL(resolve(item.directory, item.host!)).href, config: { ...item.config, $plugin: identity } }
    })
  }
  markActive(id: string) { if (!this.bootEnabled.has(id)) throw new Error(`Extension was not selected at startup: ${id}`); this.active.add(id) }
  private save() { return writeFile(join(this.config.root, 'installed.json'), JSON.stringify(this.installed, null, 2) + '\n', { mode: 0o600 }) }
  private async verifyPackage(item: Installed) {
    const actual = `sha256:${await packageHash(item.directory)}`
    if (actual !== item.integrity) throw new AppError('PLUGIN_INTEGRITY_MISMATCH', `Installed plugin ${item.id}@${item.version} has changed. Expected ${item.integrity}; found ${actual}.`, 409)
    if (item.host) await confined(item.directory, item.host)
    if (item.python) { await confined(item.directory, item.python.entry); await lstat(join(item.directory, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')) }
    if (item.client) { await confined(item.directory, item.client.entry); for (const css of item.client.css || []) await confined(item.directory, css) }
  }
  private async idle() { if (!await this.ctx.tasks.idle()) throw new AppError('TASK_BUSY', 'Finish or cancel active tasks before changing extensions.', 409) }
  async setEnabled(id: string, enabled: boolean) {
    await this.idle()
    if (typeof enabled !== 'boolean') throw new AppError('INVALID_CONFIG', 'enabled must be boolean.', 422)
    const item = this.installed.find(item => item.id === id)
    if (!item) throw new AppError('NOT_FOUND', 'Extension not found.', 404)
    if (enabled) await this.verifyPackage(item)
    const next = this.installed.map(entry => entry === item ? { ...entry, enabled } : entry)
    await writeFile(join(this.config.root, 'installed.json'), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    this.installed = next; return this.list()
  }
  async remove(id: string) {
    await this.idle()
    const item = this.installed.find(item => item.id === id)
    if (!item) throw new AppError('NOT_FOUND', 'Extension not found.', 404)
    if (this.bootEnabled.has(id)) throw new AppError('RESTART_REQUIRED', 'Disable this extension and restart before removing it.', 409)
    await rm(item.directory, { recursive: true })
    this.installed = this.installed.filter(entry => entry !== item); await this.save()
  }
  async install(request: InstallRequest) {
    await this.idle()
    if (this.busy) throw new AppError('INSTALL_BUSY', 'Another extension installation is running.', 409)
    if (typeof request.source !== 'string' || !request.source) throw new AppError('INVALID_CONFIG', 'An extension source is required.', 422)
    this.busy = true
    const staging = join(this.config.root, `install-${randomUUID()}`)
    const log: string[] = []
    const run = async (command: string, args: string[], cwd = staging) => {
      log.push(`$ ${command} ${args.join(' ')}`)
      try {
        const result = await this.ctx.process.run({ command, args, cwd })
        log.push(result.stdout, result.stderr); await writeFile(join(staging, 'install.log'), log.join('\n'), { mode: 0o600 }); return result.stdout
      } catch (error) { log.push(String(error)); await writeFile(join(staging, 'install.log'), log.join('\n'), { mode: 0o600 }); throw error }
    }
    try {
      await mkdir(staging, { mode: 0o700 })
      const directory = join(staging, 'package')
      let commit: string | undefined
      const github = /^(?:https:\/\/github\.com\/|github:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(request.source)
      if (github) {
        await run('git', ['clone', '--no-checkout', `https://github.com/${github[1]}.git`, directory])
        const ref = request.ref || 'HEAD'
        if (ref.startsWith('-')) throw new AppError('INVALID_CONFIG', 'Invalid Git ref.', 422)
        if (request.ref) await run('git', ['fetch', 'origin', ref], directory)
        commit = (await run('git', ['rev-parse', '--verify', `${request.ref ? 'FETCH_HEAD' : 'HEAD'}^{commit}`], directory)).trim()
        await run('git', ['checkout', '--detach', commit!], directory)
      } else if (request.source.startsWith('npm:')) {
        const spec = request.source.slice(4)
        if (!/^(?:@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(spec)) throw new AppError('INVALID_CONFIG', 'Use an exact npm package version.', 422)
        const packed = JSON.parse(await run('npm', ['pack', spec, '--json', '--registry=https://registry.npmmirror.com', '--pack-destination', staging]))
        await run('tar', ['-xzf', join(staging, packed[0].filename), '-C', staging])
      } else {
        const source = await realpath(resolve(request.source.replace(/^file:/, '')))
        await cp(source, directory, { recursive: true, filter: path => !['node_modules', '.git', '.venv'].some(part => relative(source, path).split('/').includes(part)) })
      }
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      const meta = manifest.youdub
      if (!meta || !cleanId(meta.id) || !compatible(meta.sdkVersion) || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) throw new AppError('INCOMPATIBLE_PLUGIN', 'Invalid YouDub plugin identity, version, or SDK range.', 422)
      if (this.installed.some(item => item.id === meta.id)) throw new AppError('PLUGIN_EXISTS', 'Disable, restart, and remove the installed version before replacing it.', 409)
      if (manifest.dependencies?.cordis || manifest.dependencies?.['@youdub/sdk']) throw new AppError('INCOMPATIBLE_PLUGIN', 'Cordis and the SDK must be peer dependencies.', 422)
      if (meta.build && meta.build !== 'npm') throw new AppError('INVALID_CONFIG', 'Supported build entry: npm.', 422)
      if (meta.build || manifest.dependencies && Object.keys(manifest.dependencies).length) await run('npm', ['install', ...(meta.build ? [] : ['--omit=dev']), '--legacy-peer-deps', '--registry=https://registry.npmmirror.com'], directory)
      const require = createRequire(import.meta.url)
      const shared = new Map([['cordis', await realpath(dirname(require.resolve('cordis/package.json')))], ['@youdub/sdk', await realpath(resolve(this.config.repoRoot, 'packages/sdk'))]])
      for (const [name, target] of shared) {
        const destination = join(directory, 'node_modules', name)
        await mkdir(dirname(destination), { recursive: true })
        try { await lstat(destination); throw new AppError('INCOMPATIBLE_PLUGIN', `Plugin installed its own ${name}.`, 422) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        await symlink(target, destination, 'dir')
      }
      await verifySharedModules(directory, shared)
      if (meta.build) await run('npm', ['run', 'build'], directory)
      await verifySharedModules(directory, shared)
      if (meta.python) {
        if (meta.host) throw new AppError('INVALID_CONFIG', 'Choose a Host entry or the standard Python bridge.', 422)
        await confined(directory, meta.python.entry)
        if (!meta.python.provider?.id || !Array.isArray(meta.python.provider.operations) || !meta.python.provider.operations.length) throw new AppError('INVALID_CONFIG', 'Python plugins require a provider descriptor with operations.', 422)
        await run('python3', ['-m', 'venv', '.venv'], directory)
        if (meta.python.requirements) {
          const requirements = await confined(directory, meta.python.requirements)
          const python = join(directory, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
          try { await run(python, ['-m', 'pip', 'install', '--index-url', 'https://mirrors.aliyun.com/pypi/simple/', '-r', requirements], directory) }
          catch (error) {
            if (!/No matching distribution found|Could not find a version that satisfies/.test(String(error))) throw error
            log.push('Aliyun has no matching distribution. Retrying the same requirements using only the Tsinghua mirror.')
            await run(python, ['-m', 'pip', 'install', '--index-url', 'https://pypi.tuna.tsinghua.edu.cn/simple/', '-r', requirements], directory)
          }
        }
      }
      if (meta.host) await confined(directory, meta.host)
      if (meta.client) { await confined(directory, meta.client.entry); for (const css of meta.client.css || []) await confined(directory, css) }
      if (!meta.host && !meta.client && !meta.python) throw new AppError('INVALID_CONFIG', 'Plugin must provide a Host, Client, or Python entry.', 422)
      const integrity = await packageHash(directory)
      const item: Installed = { id: meta.id, version: manifest.version, integrity: `sha256:${integrity}`, source: request.source, commit, directory, host: meta.host, python: meta.python, client: meta.client, enabled: request.enabled ?? true, config: request.config || {} }
      const next = [...this.installed, item]
      await writeFile(join(this.config.root, 'installed.json'), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
      this.installed = next
      return { id: item.id, version: item.version, commit, installed: true, enabled: item.enabled, active: false, restartRequired: true }
    } catch (error) {
      await writeFile(join(staging, 'failure.json'), JSON.stringify({ state: 'failed', source: request.source, error: error instanceof Error ? error.stack : String(error) }, null, 2), { mode: 0o600 }).catch(reportError => { this.ctx.logger.error(reportError) })
      throw new AppError(error instanceof AppError ? error.code : 'PLUGIN_INSTALL_FAILED', `Extension installation failed. Partial files and diagnostics: ${staging}. ${error instanceof Error ? error.message : String(error)}`, error instanceof AppError ? error.status : 500)
    } finally { this.busy = false }
  }
  clientManifest(authenticated: boolean) {
    const external: ClientModule[] = this.installed.filter(item => this.bootEnabled.has(item.id) && item.client && (!(item.host || item.python) || this.active.has(item.id))).map(item => ({ id: item.id, version: item.version, access: item.client!.access || 'authenticated', url: `/api/plugins/${item.id}/${item.version}/${item.client!.entry}`, css: item.client!.css?.map(path => `/api/plugins/${item.id}/${item.version}/${path}`), config: item.config }))
    return { version: 1, sdkVersion: '1.0.0', platformVersion: '1', modules: [...this.builtin.modules, ...external].filter(item => authenticated || item.access === 'public') }
  }
  async asset(packageId: string, version: string, asset: string, authenticated: boolean) {
    if (packageId === 'youdub-client' && version === '1.0.0' && this.config.builtinClientManifest) {
      const prefix = `/api/plugins/${packageId}/${version}/`
      const publicAssets = this.builtin.modules.filter(item => item.access === 'public').flatMap(item => [item.url, ...(item.css || [])]).concat((this.builtin.publicAssets || []).map(path => prefix + path))
      if (!authenticated && !publicAssets.includes(prefix + asset)) throw new AppError('UNAUTHORIZED', 'Authentication required.', 401)
      return { path: await confined(dirname(this.config.builtinClientManifest), asset), mime: mime[extname(asset)] || 'application/octet-stream' }
    }
    const item = this.installed.find(item => item.id === packageId && item.version === version && this.bootEnabled.has(item.id))
    if (!item?.client) throw new AppError('NOT_FOUND', 'Client extension not found.', 404)
    const allowed = [item.client.entry, ...(item.client.css || [])]
    if (!allowed.includes(asset)) throw new AppError('NOT_FOUND', 'Client asset is not declared.', 404)
    if (!authenticated && item.client.access !== 'public') throw new AppError('UNAUTHORIZED', 'Authentication required.', 401)
    return { path: await confined(item.directory, asset), mime: mime[extname(asset)] || 'application/octet-stream' }
  }
}

async function verifySharedModules(directory: string, shared: Map<string, string>) {
  const check = async (name: string, path: string) => {
    let actual: string
    try { actual = await realpath(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new AppError('INCOMPATIBLE_PLUGIN', `Shared module ${name} is missing: ${path}`, 422)
    }
    if (actual !== shared.get(name)) throw new AppError('INCOMPATIBLE_PLUGIN', `Plugin installed its own ${name}: ${path}`, 422)
  }
  for (const name of shared.keys()) await check(name, join(directory, 'node_modules', name))
  const visited = new Set<string>()
  const inspect = async (modules: string) => {
    let root: string
    try { root = await realpath(modules) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (visited.has(root)) return
    visited.add(root)
    const inspectPackage = async (name: string, path: string) => {
      if (shared.has(name)) await check(name, path)
      else await inspect(join(path, 'node_modules'))
    }
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || !entry.isDirectory() && !entry.isSymbolicLink()) continue
      const path = join(root, entry.name)
      if (entry.name.startsWith('@')) {
        for (const scoped of await readdir(path, { withFileTypes: true })) if (scoped.isDirectory() || scoped.isSymbolicLink()) await inspectPackage(`${entry.name}/${scoped.name}`, join(path, scoped.name))
      } else await inspectPackage(entry.name, path)
    }
  }
  await inspect(join(directory, 'node_modules'))
}

async function packageHash(root: string) {
  const hash = createHash('sha256')
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', '.git', '.venv'].includes(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) { hash.update(relative(root, path)).update('\0').update(await readFile(path)).update('\0') }
      else throw new AppError('INVALID_PLUGIN', `Unsupported symbolic link or special file: ${relative(root, path)}`, 422)
    }
  }
  await walk(root); return hash.digest('hex')
}

async function confined(root: string, path: string) {
  if (typeof path !== 'string' || !path || path.startsWith('/')) throw new AppError('INVALID_PATH', 'A relative plugin asset path is required.', 422)
  const base = await realpath(root), file = await realpath(resolve(base, path)), rel = relative(base, file)
  if (rel.startsWith('..') || !rel) throw new AppError('INVALID_PATH', 'Plugin asset escapes its directory.', 403)
  if (!(await lstat(file)).isFile()) throw new AppError('NOT_FOUND', 'Plugin asset is not a file.', 404)
  return file
}
