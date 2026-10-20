import { Service, type Context } from 'cordis'
import type { EntryOptions } from '@cordisjs/plugin-loader'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { homedir, release } from 'node:os'
import { join, resolve } from 'node:path'
import { AppError, type CatalogService } from '@youdub/sdk'
import { readJson, type HttpRequest } from './http.js'
import { DownloadClient, fileSize } from './setup-download.js'
import { EnvironmentSetup, type EnvironmentConfig, type DependencyGroup, type EnvironmentStep } from './setup-environment.js'
import modelManifest from './setup-models.json' with { type: 'json' }
import { parseWorkflowDocument } from './workflow-document.js'
import { nodeTypes } from './workflow-graph.js'

export interface SetupConfig extends EnvironmentConfig { entries: EntryOptions[]; version: string }
type ModelStatus = 'pending' | 'downloading' | 'paused' | 'ready' | 'failed'
export interface ModelDownload {
  id: string; name: string; variant: string; purpose: string; status: ModelStatus;
  received: number; total: number; speed: number; source?: string; error?: string
}
export interface ResourceSelection { providerId: string; model?: string }
export interface ResourceRequirement extends ResourceSelection {
  ready: boolean; automatic: boolean; missingPackages: string[]; reason?: string
}
export interface ResourcePreparationSnapshot {
  status: 'missing' | 'preparing' | 'ready' | 'failed'
  selections: ResourceSelection[]
  requirements: ResourceRequirement[]
  environment: EnvironmentStep[]
  models: ModelDownload[]
  error?: string
  activePreparation?: { selections: ResourceSelection[]; status: ResourcePreparationSnapshot['status']; error?: string }
}
const providerGroups: Record<string, DependencyGroup[]> = {
  'youdub.media': ['media'], 'youdub.download': ['download', 'media'], openai: ['openai'],
  whisper: ['media', 'whisper'], voxcpm: ['media', 'voxcpm'],
  demucs: ['media', 'demucs'], qwen_forced_aligner: ['media', 'qwen_forced_aligner'],
}
const modelProviders: Record<string, string> = { whisper: 'whisper', voxcpm: 'voxcpm', demucs: 'demucs', qwen_forced_aligner: 'qwen' }
const automaticModels: Record<string, string> = { whisper: 'tiny', voxcpm: 'VoxCPM2', demucs: 'htdemucs', qwen_forced_aligner: 'Qwen3-ForcedAligner-0.6B-hf' }
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
  private resourceEnvironment: EnvironmentSetup
  private catalog?: CatalogService
  private resourceState?: ResourcePreparationSnapshot
  private resourceJob?: Promise<void>
  private resourceRequest?: Promise<ResourcePreparationSnapshot>
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
    this.resourceEnvironment = new EnvironmentSetup(ctx, config, this.client, this.stopping.signal)
    ctx.inject(['catalog'], scope => {
      this.catalog = scope.catalog
      scope.effect(() => () => { this.catalog = undefined })
    })
    ctx.inject(['catalog', 'auth'], scope => {
      for (const action of ['check', 'prepare'] as const) {
        scope.effect(() => scope.http.register('POST', `/api/v2/workflow-documents/resources/${action}`, async request => {
          const { document: raw } = await readJson(request)
          const document = parseWorkflowDocument(raw), types = nodeTypes(scope.catalog)
          const selections = document.nodes.map(node => {
            if (!types.some(type => type.type === node.type && type.version === node.typeVersion && type.providerId === node.provider.id)) {
              throw new AppError('NODE_TYPE_UNAVAILABLE', `节点 ${node.id} 的类型、版本或供应商不可用。`, 422)
            }
            return { providerId: node.provider.id, model: node.provider.model }
          })
          scope.http.json(request, 200, await (action === 'check' ? this.checkResources(selections) : this.prepareResources(selections)))
        }))
      }
    })
    let started = false
    ctx.on('app/ready', () => { if (!started) { started = true; this.prepare() } })
    ctx.effect(() => async () => {
      this.stopping.abort(new Error('Application is stopping'))
      for (const { controller } of this.jobs.values()) controller.abort(new Error('Application is stopping'))
      await Promise.all([this.preparing, this.finishing, this.resourceJob, ...[...this.jobs.values()].map(job => job.promise)])
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
      if (this.phase === 'starting') throw new AppError('SETUP_FINISHED', '工作台正在启动。', 409)
      if (action === 'retry' && !id && this.phase === 'failed') {
        if (this.bootAttempted) throw new AppError('RESTART_REQUIRED', '工作台启动失败，请查看错误后重启应用。', 409)
        this.prepare()
      } else {
        if (this.phase !== 'ready' || !this.resourceState) throw new AppError('ENVIRONMENT_NOT_READY', '当前没有正在准备的工作流依赖。', 409)
        const targets = this.resourceState.models.filter(model => (!id || model.id === id) && model.status !== 'ready')
        if (action === 'pause') {
          for (const model of targets) {
            const job = this.jobs.get(model.id)
            if (job) job.controller.abort(new Error('Paused by user'))
            else if (model.status !== 'failed') model.status = 'paused'
          }
          await Promise.all(targets.map(model => this.jobs.get(model.id)?.promise))
        } else if (!this.resourceJob) {
          await this.prepareResources(this.resourceState.selections)
        } else for (const model of targets) if (['paused', 'failed', 'pending'].includes(model.status)) {
          model.status = 'pending'
          if (this.resourceEnvironment.steps.every(step => step.status === 'ready')) this.download(model.id)
        }
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
    return { phase: this.phase, version: this.config.version, platform: process.platform, arch: process.arch, osVersion: release(), homeDir: homedir(), environment: this.environment.steps,
      models: [], resources: this.resourceState, error: this.error, canRetry: !this.bootAttempted, token: this.token }
  }
  private selections(value: ResourceSelection[]) {
    if (!Array.isArray(value) || value.some(item => !item || typeof item.providerId !== 'string' || !item.providerId || (item.model !== undefined && typeof item.model !== 'string'))) {
      throw new AppError('INVALID_INPUT', '工作流依赖必须包含有效的 providerId 和 model。', 422)
    }
    return [...new Map(value.map(({ providerId, model }) => [JSON.stringify([providerId, model]), { providerId, ...(model ? { model } : {}) }])).values()]
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  private groups(selections: ResourceSelection[]) {
    return [...new Set<DependencyGroup>(['base', ...selections.flatMap(item => providerGroups[item.providerId] || [])])]
  }
  private async inspectResources(selections: ResourceSelection[]): Promise<ResourcePreparationSnapshot> {
    const requirements: ResourceRequirement[] = []
    const requiredModels = new Set<string>()
    // A user may have installed a package/model outside this process. Refresh
    // only this graph's providers so validation sees the same current readiness.
    if (this.catalog) for (const providerId of new Set(selections.map(item => item.providerId))) {
      await this.catalog.provider(providerId).probe()
    }
    for (const selection of selections) {
      const groups = providerGroups[selection.providerId]
      if (!groups) {
        const provider = this.catalog?.listProviders().find(item => item.id === selection.providerId)
        const ready = provider?.available === true && (!selection.model || provider.models?.some(model => model.id === selection.model) === true)
        requirements.push({ ...selection, ready, automatic: false, missingPackages: [],
          ...(!ready ? { reason: provider?.unavailableReason || '请根据该插件的要求准备运行依赖。' } : {}) })
        continue
      }
      const result = await this.resourceEnvironment.probe('resources', ['base', ...groups])
      let reason = result.missing.length ? `缺少运行依赖：${result.missing.join(', ')}` :
        !result.media ? result.mediaReason || '缺少 FFmpeg 或 FFprobe。' : !result.punkt ? '缺少 Whisper 分句资源。' :
          !result.demucsSource ? '缺少 Demucs 子模块源码。' : undefined
      const modelId = modelProviders[selection.providerId]
      const automatic = !modelId || !selection.model || selection.model === automaticModels[selection.providerId]
      if (modelId && automatic) requiredModels.add(modelId)
      if (!reason && modelId) {
        const modelProbe = (await this.resourceEnvironment.probe('models', [selection.providerId]))[selection.providerId]
        const selectedModel = selection.model || automaticModels[selection.providerId]
        if (!modelProbe.models.some((model: { id: string }) => model.id === selectedModel)) {
          reason = modelProbe.unavailable_reason || `未安装模型：${selectedModel}`
        }
      }
      requirements.push({ ...selection, ready: !reason, automatic, missingPackages: result.missing, ...(reason ? { reason } : {}) })
    }
    const models = this.models.filter(model => requiredModels.has(model.id))
    for (const model of models) {
      if (this.jobs.has(model.id)) continue
      const definition = modelManifest.find(item => item.id === model.id)!
      const sizes = await Promise.all(definition.files.map(file => fileSize(join(this.root(model.id), file.path))))
      model.received = sizes.reduce((sum, size, i) => sum + (size === definition.files[i]!.size ? size : 0), 0)
      model.status = sizes.every((size, i) => size === definition.files[i]!.size) ? 'ready' : 'pending'
      if (model.status !== 'ready') for (const requirement of requirements) {
        if (requirement.automatic && modelProviders[requirement.providerId] === model.id) {
          requirement.ready = false
          requirement.reason ??= `${model.name} 模型文件未安装或不完整。`
        }
      }
    }
    return { status: requirements.every(item => item.ready) ? 'ready' : 'missing', selections, requirements, models, environment: [] }
  }
  async checkResources(value: ResourceSelection[]) {
    const selections = this.selections(value)
    if (this.resourceState && JSON.stringify(this.resourceState.selections) === JSON.stringify(selections) &&
        (this.resourceJob || this.resourceState.status === 'failed')) {
      return { ...this.resourceState, environment: this.resourceEnvironment.steps }
    }
    const inspected = await this.inspectResources(selections)
    if (this.resourceState && JSON.stringify(this.resourceState.selections) !== JSON.stringify(selections)) {
      inspected.activePreparation = { selections: this.resourceState.selections, status: this.resourceState.status, ...(this.resourceState.error ? { error: this.resourceState.error } : {}) }
    }
    return inspected
  }
  async prepareResources(value: ResourceSelection[]) {
    if (this.resourceRequest) throw new AppError('RESOURCE_PREPARATION_BUSY', '工作流依赖检查正在进行。', 409)
    this.resourceRequest = this.startResourcePreparation(value)
    try { return await this.resourceRequest }
    finally { this.resourceRequest = undefined }
  }
  private async startResourcePreparation(value: ResourceSelection[]) {
    if (this.phase !== 'ready') throw new AppError('ENVIRONMENT_NOT_READY', '请等待基础环境准备完成。', 409)
    const selections = this.selections(value)
    if (this.resourceJob) {
      if (JSON.stringify(this.resourceState!.selections) !== JSON.stringify(selections)) throw new AppError('RESOURCE_PREPARATION_BUSY', '其他工作流依赖正在准备。', 409)
      return this.checkResources(selections)
    }
    const initial = await this.inspectResources(selections)
    const manual = initial.requirements.filter(item => !item.ready && !item.automatic)
    if (manual.length) throw new AppError('MANUAL_RESOURCE_REQUIRED', manual.map(item => `${item.providerId}: ${item.reason}`).join('\n'), 422)
    if (initial.status === 'ready') return initial
    this.resourceState = { ...initial, status: 'preparing' }
    this.resourceJob = (async () => {
      await this.resourceEnvironment.prepare(this.groups(selections))
      for (const model of this.resourceState!.models) if (!['ready', 'paused'].includes(model.status)) this.download(model.id)
      while (this.jobs.size) await Promise.all([...this.jobs.values()].map(job => job.promise))
      const failed = this.resourceState!.models.find(model => model.status === 'failed')
      if (failed) throw new Error(`${failed.name}: ${failed.error}`)
      if (this.resourceState!.models.some(model => model.status !== 'ready')) {
        this.resourceState!.status = 'missing'
        return
      }
      await this.resourceEnvironment.probe('verify', this.groups(selections))
      const final = await this.inspectResources(selections)
      if (final.status !== 'ready') throw new Error(final.requirements.filter(item => !item.ready).map(item => `${item.providerId}: ${item.reason}`).join('\n'))
      this.resourceState = { ...final, environment: this.resourceEnvironment.steps }
    })().catch(error => {
      if (cancelled(error, this.stopping.signal)) return
      this.resourceState!.status = 'failed'; this.resourceState!.error = message(error)
      this.ctx.logger.error(error)
    }).finally(() => { this.resourceJob = undefined })
    return { ...this.resourceState, environment: this.resourceEnvironment.steps }
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
    }).finally(() => { model.speed = 0; this.jobs.delete(id) })
    this.jobs.set(id, { controller, promise })
  }
  private finishIfReady() {
    if (this.phase !== 'environment' || this.finishing || this.stopping.signal.aborted) return
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
