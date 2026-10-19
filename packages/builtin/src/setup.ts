import { Service, type Context } from 'cordis'
import type { EntryOptions } from '@cordisjs/plugin-loader'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { homedir, release } from 'node:os'
import { join, resolve } from 'node:path'
import { AppError } from '@youdub/sdk'
import { readJson, type HttpRequest } from './http.js'
import { DownloadClient, fileSize } from './setup-download.js'
import { EnvironmentSetup, type EnvironmentConfig } from './setup-environment.js'
import modelManifest from './setup-models.json' with { type: 'json' }

export interface SetupConfig extends EnvironmentConfig { entries: EntryOptions[]; version: string }
type ModelStatus = 'pending' | 'downloading' | 'paused' | 'ready' | 'failed'
export interface ModelDownload {
  id: string; name: string; variant: string; purpose: string; status: ModelStatus;
  received: number; total: number; speed: number; source?: string; error?: string
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
function cancelled(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false
  while (error instanceof Error) {
    if (error === signal.reason) return true
    error = error.cause
  }
  return false
}
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]', '::1', '::ffff:127.0.0.1'].includes(host)
const localPath = (path: string) => resolve(path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
declare module 'cordis' { interface Context { setup: SetupService } }

export default class SetupService extends Service {
  static inject = ['http', 'process', 'loader']
  private client = new DownloadClient()
  private stopping = new AbortController()
  private token = randomBytes(32).toString('base64url')
  private environment: EnvironmentSetup
  private phase: 'environment' | 'models' | 'starting' | 'ready' | 'failed' = 'environment'
  private error?: string
  private bootAttempted = false
  private preparing?: Promise<void>
  private finishing?: Promise<void>
  private jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  private models: ModelDownload[] = modelManifest.map(model => ({ id: model.id, name: model.name, variant: model.variant, purpose: model.purpose, status: 'pending', received: 0, total: model.files.reduce((sum, file) => sum + file.size, 0), speed: 0 }))
  constructor(ctx: Context, private config: SetupConfig) {
    super(ctx, 'setup')
    this.environment = new EnvironmentSetup(ctx, config, this.client, this.stopping.signal)
    let started = false
    ctx.on('app/ready', () => { if (!started) { started = true; this.prepare() } })
    ctx.effect(() => async () => {
      this.stopping.abort(new Error('Application is stopping'))
      for (const { controller } of this.jobs.values()) controller.abort(new Error('Application is stopping'))
      await Promise.all([this.preparing, this.finishing, ...[...this.jobs.values()].map(job => job.promise)])
      await this.client.close()
    })
  }
  [Service.init]() {
    // This guard owns setup access even before Python-backed sessions exist.
    this.ctx.effect(() => this.ctx.http.use(async (request, next) => {
      if (!request.url.pathname.startsWith('/api/setup')) return next()
      this.guard(request)
      await next()
    }))
    this.ctx.effect(() => this.ctx.http.register('GET', '/api/setup', request => this.ctx.http.json(request, 200, this.snapshot())))
    this.ctx.effect(() => this.ctx.http.register('POST', '/api/setup', async request => {
      const { action, id } = await readJson(request)
      if (!['pause', 'resume', 'retry'].includes(action) || (id !== undefined && !this.models.some(model => model.id === id))) throw new AppError('INVALID_INPUT', 'Invalid setup action or model.', 422)
      if (this.phase === 'ready' || this.phase === 'starting') throw new AppError('SETUP_FINISHED', '环境准备已结束。', 409)
      if (action === 'retry' && !id && this.phase === 'failed') {
        if (this.bootAttempted) throw new AppError('RESTART_REQUIRED', '工作台启动失败，请查看错误后重启应用。', 409)
        this.prepare()
      } else {
        if (this.phase !== 'models') throw new AppError('ENVIRONMENT_NOT_READY', '请等待环境准备完成。', 409)
        const targets = this.models.filter(model => (!id || model.id === id) && model.status !== 'ready')
        if (action === 'pause') {
          for (const model of targets) {
            const job = this.jobs.get(model.id)
            if (job) job.controller.abort(new Error('Paused by user'))
            else if (model.status !== 'failed') model.status = 'paused'
          }
          await Promise.all(targets.map(model => this.jobs.get(model.id)?.promise))
        } else for (const model of targets) if (['paused', 'failed', 'pending'].includes(model.status)) this.download(model.id)
      }
      this.ctx.http.json(request, 200, this.snapshot())
    }))
  }
  private guard(request: HttpRequest) {
    const host = new URL(`http://${request.raw.headers.host || 'invalid'}`).hostname
    const origin = request.raw.headers.origin
    if (!loopback(request.raw.socket.remoteAddress || '') || !loopback(host) || (origin && !loopback(new URL(origin).hostname))) throw new AppError('LOCAL_SETUP_ONLY', '首次环境准备仅允许本机访问。', 403)
    if (!['GET', 'HEAD'].includes(request.raw.method || '')) {
      const supplied = Buffer.from(String(request.raw.headers['x-youdub-setup'] || ''))
      const expected = Buffer.from(this.token)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AppError('CSRF_INVALID', 'Invalid setup token.', 403)
    }
  }
  snapshot() {
    return { phase: this.phase, version: this.config.version, platform: process.platform, arch: process.arch, osVersion: release(), environment: this.environment.steps,
      models: this.models, error: this.error, canRetry: !this.bootAttempted, token: this.token }
  }
  private root(id: string) {
    const model = modelManifest.find(model => model.id === id)!
    return process.env[model.env]?.trim() ? localPath(process.env[model.env]!.trim()) : join(this.config.root, 'models', model.directory)
  }
  private fail(error: unknown) {
    if (cancelled(error, this.stopping.signal)) { this.ctx.logger.info('Environment preparation stopped with the application.'); return }
    this.phase = 'failed'; this.error = message(error); this.ctx.logger.error(error)
  }
  private prepare() {
    if (this.preparing) return
    this.phase = 'environment'; this.error = undefined
    this.preparing = (async () => {
      process.env.YOUDUB_DESKTOP_DATA_DIR = this.config.root
      await this.environment.prepare()
      for (const model of this.models) {
        const definition = modelManifest.find(item => item.id === model.id)!
        const sizes = await Promise.all(definition.files.map(file => fileSize(join(this.root(model.id), file.path))))
        const ready = sizes.every((size, i) => size === definition.files[i]!.size)
        model.received = sizes.reduce((sum, size, i) => sum + (size === definition.files[i]!.size ? size : 0), 0)
        model.status = ready ? 'ready' : 'pending'
      }
      this.phase = 'models'
      for (const model of this.models) if (model.status !== 'ready') this.download(model.id)
      this.finishIfReady()
    })().catch(error => this.fail(error)).finally(() => { this.preparing = undefined })
  }
  private download(id: string) {
    if (this.jobs.has(id)) return
    const model = this.models.find(item => item.id === id)!
    const definition = modelManifest.find(item => item.id === id)!
    const controller = new AbortController()
    const signal = AbortSignal.any([this.stopping.signal, controller.signal])
    model.status = 'downloading'; model.error = undefined; model.source = 'ModelScope'
    this.ctx.logger.info(`${model.name} 下载源：ModelScope`)
    const promise = (async () => {
      let completed = 0, previousBytes = 0, previousTime = Date.now()
      for (const file of definition.files) {
        let firstProgress = true
        await this.client.download(file, join(this.root(id), file.path), signal, bytes => {
          model.received = completed + bytes
          if (firstProgress) { previousBytes = model.received; previousTime = Date.now(); firstProgress = false }
          const elapsed = (Date.now() - previousTime) / 1000
          if (elapsed >= 0.5) { model.speed = Math.max(0, (model.received - previousBytes) / elapsed); previousBytes = model.received; previousTime = Date.now() }
        })
        completed += file.size
        previousBytes = completed; previousTime = Date.now()
      }
      model.status = 'ready'
    })().catch(error => {
      if (cancelled(error, signal)) model.status = 'paused'
      else { model.status = 'failed'; model.error = message(error); this.ctx.logger.error(error) }
    }).finally(() => { model.speed = 0; this.jobs.delete(id); this.finishIfReady() })
    this.jobs.set(id, { controller, promise })
  }
  private finishIfReady() {
    if (this.phase !== 'models' || this.finishing || !this.models.every(model => model.status === 'ready') || this.stopping.signal.aborted) return
    this.phase = 'starting'
    this.finishing = (async () => {
      await this.environment.probe('verify')
      this.bootAttempted = true
      for (const entry of this.config.entries) await this.ctx.loader.create(entry)
      await this.ctx.loader.await()
      const unavailable = [...this.ctx.loader.entries()].filter(entry => !entry.disabled && (!entry.fiber || entry.fiber.state !== 2))
      if (unavailable.length) throw new Error(`工作台插件启动失败：${unavailable.map(entry => entry.options.id).join(', ')}`)
      this.ctx.emit('app/ready')
      this.phase = 'ready'
    })().catch(error => this.fail(error)).finally(() => { this.finishing = undefined })
  }
}
