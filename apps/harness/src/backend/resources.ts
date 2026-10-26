import { Service } from '@deepseek-ai/cordis'
import { homedir, release } from 'node:os'
import { join } from 'node:path'
import { AppError, type CatalogService } from '@youdub/sdk'
import { DownloadClient, fileSize, sourceName } from '../../../../packages/builtin/src/setup-download.ts'
import { EnvironmentSetup, type EnvironmentConfig, type DependencyGroup, type EnvironmentStep } from '../../../../packages/builtin/src/setup-environment.ts'
import modelManifest from '../../../../packages/builtin/src/setup-models.json' with { type: 'json' }
import { parseWorkflowDocument } from '../../../../packages/builtin/src/workflow-document.ts'
import { nodeTypes } from '../../../../packages/builtin/src/workflow-graph.ts'
import { acceleratedGroups, providerResources } from '../../../../packages/builtin/src/runtime-resources.ts'
import { readJson } from './transport.mjs'
import { mergeResourceEntries, resourceEntries, type ResourceEntry, type ResourceNeed } from '../../../../packages/sdk/src/resource-state.ts'
const runtimeSelections: Record<string, { providerId: string; groups: DependencyGroup[]; name: string }> = {
  python: { providerId: '$runtime.python', groups: ['base'], name: 'Python' },
  acceleration: { providerId: '$runtime.acceleration', groups: ['acceleration'], name: '推理运行库' },
  resources: { providerId: '$runtime.punkt', groups: ['punkt'], name: '分句资源' },
}
const runtimeResource = (id: string) => Object.entries(runtimeSelections).find(([, item]) => item.providerId === id)
type ModelStatus = 'pending' | 'downloading' | 'paused' | 'ready' | 'failed'
export interface ModelDownload {
  id: string; name: string; variant: string; purpose: string; status: ModelStatus;
  received: number; total: number; speed: number; source?: string; error?: string; log?: string
}
export interface ResourceSelection { providerId: string; model?: string }
export interface ResourceRequirement extends ResourceSelection, ResourceNeed {
  ready: boolean; automatic: boolean; missingPackages: string[]; reason?: string; configurationRequired?: boolean
}
export interface ResourcePreparationSnapshot {
  status: 'missing' | 'preparing' | 'ready' | 'failed'
  entries?: ResourceEntry[]
  selections: ResourceSelection[]
  requirements: ResourceRequirement[]
  environment: EnvironmentStep[]
  models: ModelDownload[]
  error?: string
  activePreparation?: { selections: ResourceSelection[]; status: ResourcePreparationSnapshot['status']; error?: string }
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
export default class Resources extends Service {
  static inject = ['catalog', 'youdubWorker', 'jobs']
  private client = new DownloadClient()
  private stopping = new AbortController()
  private environment: EnvironmentSetup
  private resourceEnvironment: EnvironmentSetup
  private catalog: CatalogService
  private resourceState?: ResourcePreparationSnapshot
  private resourceJob?: Promise<void>
  private resourceRequest?: Promise<ResourcePreparationSnapshot>
  private jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>()
  private models: ModelDownload[] = modelManifest.map(model => ({ id: model.id, name: model.name, variant: model.variant, purpose: model.purpose, status: 'pending', received: 0, total: model.files.reduce((sum, file) => sum + file.size, 0), speed: 0 }))
  constructor(ctx: any, private config: EnvironmentConfig & { version: string; modelRoots: Record<string, string> }) {
    super(ctx, 'youdubResources')
    this.catalog = ctx.catalog
    this.environment = new EnvironmentSetup(ctx, config, this.client, this.stopping.signal)
    this.resourceEnvironment = new EnvironmentSetup(ctx, config, this.client, this.stopping.signal)
    ctx.effect(() => async () => {
      this.stopping.abort(new Error('Application is stopping'))
      for (const { controller } of this.jobs.values()) controller.abort(new Error('Application is stopping'))
      await Promise.all([this.resourceJob, ...[...this.jobs.values()].map(job => job.promise)])
      await this.client.close()
    })
  }
  async [Service.init]() {
    const python = await this.ctx.youdubWorker.run({ command: this.config.python, args: ['-c', 'import sys; print(sys.version.split()[0])'], cwd: this.config.repoRoot })
    const dependencies = await this.environment.probe('dependencies', ['base'])
    this.environment.steps = [
      { id: 'python', name: 'Python', status: 'ready', detail: python.stdout.trim() },
      { id: 'dependencies', name: '基础运行依赖', status: dependencies.missing.length ? 'failed' : 'ready', ...(dependencies.missing.length ? { detail: dependencies.missing.join(', ') } : {}) },
    ]
  }
  private runJob(label: string, controller: AbortController, execute: () => Promise<void>) {
    let result!: Promise<void>
    this.ctx.jobs.start({ label, run() {
      result = Promise.resolve().then(execute)
      return { cancel(reason?: string) { controller.abort(new Error(reason || 'Resource preparation cancelled')) }, done: result.then(
        () => ({ status: controller.signal.aborted ? 'killed' as const : 'completed' as const }),
        error => ({ status: controller.signal.aborted ? 'killed' as const : 'failed' as const, detail: message(error) }),
      ) }
    } })
    return result
  }
  catalogSelections(value: ResourceSelection[]) {
    const selections = this.selections(value)
    const providers = this.catalog!.listProviders()
    for (const selection of selections) {
      if (runtimeResource(selection.providerId) && !selection.model) continue
      const provider = providers.find(item => item.id === selection.providerId)
      if (!provider) throw new AppError('PROVIDER_UNAVAILABLE', `Provider ${selection.providerId} is not registered.`, 422)
      if (selection.model && selection.model !== providerResources(provider)?.model?.id && !provider.models?.some(model => model.id === selection.model)) {
        throw new AppError('MODEL_UNAVAILABLE', `所选模型不可用：${selection.model}`, 422)
      }
    }
    return selections
  }
  private snapshot(state: ResourcePreparationSnapshot) {
    const current = { ...state, environment: state === this.resourceState && this.resourceJob ? this.resourceEnvironment.steps : state.environment }
    return { ...current, entries: resourceEntries(current) }
  }
  async resourceTargets(ids: unknown) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw new AppError('INVALID_INPUT', '请选择有效资源。', 422)
    const inventory = await this.resourceInventory()
    return this.catalogSelections(ids.map(id => {
      const runtime = runtimeSelections[id]
      if (runtime) return { providerId: runtime.providerId }
      const item = inventory.items.find(item => (item.downloadId || (item.model ? `${item.providerId}:${item.model}` : item.providerId === 'youdub.media' ? 'ffmpeg' : item.providerId)) === id)
      if (!item) throw new AppError('INVALID_INPUT', `未知资源：${id}`, 422)
      return { providerId: item.providerId, ...(item.model ? { model: item.model } : {}) }
    }))
  }
  async resourceInventory() {
    const providers = (this.catalog?.listProviders() || []).filter(provider => provider.execution !== 'remote' && !provider.models?.some(model => model.devices?.includes('remote')))
    const items = providers.flatMap(provider => {
      const resources = providerResources(provider)
      const models = [...new Set([...(resources?.model ? [resources.model.id] : []), ...(provider.models || []).map(model => model.id)])]
      return (models.length ? models : [undefined]).map(model => ({
        providerId: provider.id, ...(model ? { model } : {}), label: provider.label || provider.id,
        automatic: Boolean(resources) && (!model || model === resources?.model?.id),
        ...(resources?.model && model === resources.model.id ? { downloadId: resources.model.downloadId } : {}),
      }))
    })
    for (const runtime of Object.values(runtimeSelections)) items.push({ providerId: runtime.providerId, label: runtime.name, automatic: true })
    const models = this.models.filter(model => items.some(item => item.downloadId === model.id))
    await this.refreshModelSizes(models)
    return { version: this.config.version, platform: process.platform, arch: process.arch, osVersion: release(), homeDir: homedir(),
      environment: this.environment.steps, items, models, resources: this.resourceState && this.snapshot(this.resourceState) }
  }
  async resourceAction(action: string, id?: string) {
    if (!['pause', 'resume', 'retry'].includes(action) || (id !== undefined && typeof id !== 'string')) throw new AppError('INVALID_INPUT', 'Invalid resource action or model.', 422)
    if (!this.resourceState) throw new AppError('ENVIRONMENT_NOT_READY', '当前没有正在准备的运行依赖。', 409)
    if (id !== undefined && !this.resourceState.models.some(model => model.id === id)) throw new AppError('INVALID_INPUT', '该模型不属于当前准备任务。', 422)
    const targets = this.resourceState.models.filter(model => (!id || model.id === id) && model.status !== 'ready')
    if (action === 'pause') {
      for (const model of targets) {
        const job = this.jobs.get(model.id)
        if (job) job.controller.abort(new Error('Paused by user'))
        else if (model.status !== 'failed') model.status = 'paused'
      }
      await Promise.all(targets.map(model => this.jobs.get(model.id)?.promise))
    } else {
      for (const model of targets) if (['paused', 'failed', 'pending'].includes(model.status)) { model.status = 'pending'; model.error = undefined }
      if (!this.resourceJob) await this.prepareResources(this.resourceState.selections)
      else for (const model of targets) if (model.status === 'pending' && this.resourceEnvironment.steps.every(step => step.status === 'ready')) this.download(model.id)
    }
  }
  private selections(value: ResourceSelection[]) {
    if (!Array.isArray(value) || value.some(item => !item || typeof item.providerId !== 'string' || !item.providerId || Object.keys(item).some(key => !['providerId', 'model'].includes(key)) || (item.model !== undefined && typeof item.model !== 'string'))) {
      throw new AppError('INVALID_INPUT', '工作流依赖必须包含有效的 providerId 和 model。', 422)
    }
    return [...new Map(value.map(({ providerId, model }) => [JSON.stringify([providerId, model]), { providerId, ...(model ? { model } : {}) }])).values()]
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  private groups(selections: ResourceSelection[]) {
    const providers = this.catalog?.listProviders() ?? []
    return [...new Set<DependencyGroup>(['base', ...selections.flatMap(item => {
      const runtime = runtimeResource(item.providerId)
      if (runtime) return runtime[1].groups
      const provider = providers.find(provider => provider.id === item.providerId)
      return provider ? providerResources(provider)?.dependencyGroups ?? [] : []
    })])]
  }
  private async inspectResources(selections: ResourceSelection[]): Promise<ResourcePreparationSnapshot> {
    const requirements: ResourceRequirement[] = []
    const requiredModels = new Set<string>()
    const inspections = new Map<string, Promise<any>>()
    const inspect = (groups: DependencyGroup[]) => {
      const selected = [...new Set<DependencyGroup>(['base', ...groups])].sort()
      const key = selected.join(',')
      if (!inspections.has(key)) inspections.set(key, this.resourceEnvironment.probe('resources', selected))
      return inspections.get(key)!
    }
    const base = await inspect(['base'])
    const missingPackages = new Set<string>(base.missing)
    let mediaReady = true, mediaReason: string | undefined, punktReady = true
    // A user may have installed a package/model outside this process. Refresh
    // only this graph's providers so validation sees the same current readiness.
    if (this.catalog) for (const providerId of new Set(selections.map(item => item.providerId))) {
      if (!runtimeResource(providerId)) await this.catalog.provider(providerId).probe()
    }
    for (const selection of selections) {
      const runtime = runtimeResource(selection.providerId)
      if (runtime) {
        const [resourceId, definition] = runtime
        const result = await inspect(definition.groups)
        for (const name of result.missing) missingPackages.add(name)
        if (!result.punkt) punktReady = false
        requirements.push({ ...selection, resourceId, name: definition.name, dependencies: resourceId === 'python' ? [] : ['python'], ready: !result.missing.length && result.punkt, automatic: true, missingPackages: result.missing,
          ...((result.missing.length || !result.punkt) ? { reason: result.missing.length ? `缺少运行依赖：${result.missing.join(', ')}` : '缺少分句资源。' } : {}) })
        continue
      }
      const provider = this.catalog?.listProviders().find(item => item.id === selection.providerId)
      const resources = provider && providerResources(provider)
      const groups = resources?.dependencyGroups
      if (!groups) {
        const ready = provider?.available === true && (!selection.model || provider.models?.some(model => model.id === selection.model) === true)
        requirements.push({ ...selection, remote: provider?.execution === 'remote', resourceId: selection.model ? `${selection.providerId}:${selection.model}` : selection.providerId, name: typeof provider?.label === 'string' ? provider.label : selection.providerId, ready, automatic: false, missingPackages: [],
          ...(!ready ? { reason: provider?.unavailableReason || '请根据该插件的要求准备运行依赖。' } : {}) })
        continue
      }
      const result = await inspect(groups)
      for (const name of result.missing) missingPackages.add(name)
      if (!result.media) { mediaReady = false; mediaReason = result.mediaReason }
      if (!result.punkt) punktReady = false
      let reason = result.missing.length ? `缺少运行依赖：${result.missing.join(', ')}` :
        !result.media ? result.mediaReason || '缺少 FFmpeg 或 FFprobe。' : !result.punkt ? '缺少 Whisper 分句资源。' :
          !result.demucsSource ? '缺少 Demucs 子模块源码。' : undefined
      const modelId = resources?.model?.downloadId
      let automatic = !modelId || !selection.model || selection.model === resources?.model?.id
      let configurationRequired = false
      if (!reason && provider?.execution === 'remote') {
        const model = provider.models?.find(model => model.id === selection.model)
        if (!provider.available) reason = provider.unavailableReason || '远端服务尚未配置。'
        else if (!selection.model) reason = '请在工作流节点中选择翻译模型。'
        else if (!model || model.available === false) reason = model?.unavailableReason || `所选模型不可用：${selection.model}`
        if (reason) { automatic = false; configurationRequired = true }
      }
      if (modelId && automatic) requiredModels.add(modelId)
      if (!reason && modelId) {
        const selectedModel = selection.model || resources?.model?.id
        if (!provider?.models?.some(model => model.id === selectedModel)) {
          reason = provider?.unavailableReason || `未安装模型：${selectedModel}`
        }
      }
      if (!reason && provider?.available !== true) reason = provider?.unavailableReason || '运行服务尚未就绪。'
      requirements.push({ ...selection, remote: provider?.execution === 'remote', resourceId: modelId && automatic ? modelId : selection.model ? `${selection.providerId}:${selection.model}` : selection.providerId === 'youdub.media' ? 'ffmpeg' : selection.providerId, name: modelId ? modelManifest.find(model => model.id === modelId)!.name : typeof provider?.label === 'string' ? provider.label : selection.providerId, downloadId: automatic ? modelId : undefined,
        dependencies: ['python', ...(groups.some(group => acceleratedGroups.includes(group)) ? ['acceleration'] : []), ...(groups.includes('media') && selection.providerId !== 'youdub.media' ? ['ffmpeg'] : []), ...(groups.includes('whisper') ? ['resources'] : [])], ready: !reason, automatic, missingPackages: result.missing, ...(reason ? { reason } : {}), ...(configurationRequired ? { configurationRequired } : {}) })
    }
    const models = this.models.filter(model => requiredModels.has(model.id))
    await this.refreshModelSizes(models)
    for (const model of models) {
      if (model.status !== 'ready') for (const requirement of requirements) {
        if (requirement.automatic && this.catalog?.listProviders().some(provider => provider.id === requirement.providerId && providerResources(provider)?.model?.downloadId === model.id)) {
          requirement.ready = false
          requirement.reason ??= `${model.name} 模型文件未安装或不完整。`
        }
      }
    }
    const groups = this.groups(selections)
    const environment: EnvironmentStep[] = this.environment.steps.filter(step => step.id === 'python').map(step => ({ ...step, status: base.missing.length ? 'pending' as const : step.status, detail: [step.detail, this.config.python, ...base.missing].filter(Boolean).join(' · ') }))
    if (groups.some(group => acceleratedGroups.includes(group))) {
      const plan = await this.resourceEnvironment.probe('acceleration-plan')
      if (plan.installed) {
        const actual = await this.resourceEnvironment.probe('acceleration')
        const failed = actual.devices?.some((device: { available: boolean }) => !device.available)
        environment.push({ id: 'acceleration', name: 'GPU 与推理后端', status: failed ? 'failed' : actual.backend ? 'ready' : 'pending', detail: actual.detail || '尚未取得推理后端检测结果。' })
      } else environment.push({ id: 'acceleration', name: 'GPU 与推理后端', status: 'pending', detail: plan.detail })
    }
    environment.push({ id: 'dependencies', name: groups.length > 1 ? '运行依赖' : '基础运行依赖', status: missingPackages.size ? 'pending' : 'ready', ...(missingPackages.size ? { detail: `缺少：${[...missingPackages].join(', ')}` } : {}) })
    if (groups.includes('media')) environment.push({ id: 'ffmpeg', name: 'FFmpeg', status: mediaReady ? 'ready' : 'pending', ...(mediaReason ? { detail: mediaReason } : {}) })
    if (groups.includes('whisper') || groups.includes('punkt')) environment.push({ id: 'resources', name: '分句资源', status: punktReady ? 'ready' : 'pending' })
    for (const requirement of requirements) {
      const dependency = environment.find(step => (step.id === requirement.resourceId || requirement.dependencies?.includes(step.id)) && step.status !== 'ready')
      if (dependency) { requirement.ready = false; requirement.reason ??= dependency.detail || `${dependency.name} 尚未就绪。` }
    }
    return this.snapshot({ status: !missingPackages.size && requirements.every(item => item.ready) ? 'ready' : 'missing', selections, requirements, models, environment })
  }
  private async refreshModelSizes(models: ModelDownload[]) {
    for (const model of models) {
      if (this.jobs.has(model.id)) continue
      const definition = modelManifest.find(item => item.id === model.id)!
      const sizes = await Promise.all(definition.files.map(async file => ({ size: await fileSize(join(this.root(model.id), file.path)), partial: await fileSize(join(this.root(model.id), file.path) + '.part') })))
      model.received = sizes.reduce((sum, size, i) => sum + Math.min(definition.files[i]!.size, size.size || size.partial), 0)
      // Reading status must not erase a paused transfer or a failed verification.
      if (!['paused', 'failed'].includes(model.status)) model.status = sizes.every((size, i) => size.size === definition.files[i]!.size) ? 'ready' : 'pending'
    }
  }
  async checkResources(value: ResourceSelection[]) {
    const selections = this.selections(value)
    const previous = this.resourceState
    const sameSelection = previous && JSON.stringify(previous.selections) === JSON.stringify(selections)
    if (sameSelection && (this.resourceJob || (previous.status === 'failed' && !previous.requirements.some(item => item.configurationRequired)))) {
      return this.snapshot({ ...previous, environment: this.resourceEnvironment.steps })
    }
    const inspected = await this.inspectResources(selections)
    if (sameSelection && this.resourceState === previous && !this.resourceJob) {
      this.resourceState = previous.status === 'failed' && inspected.status !== 'ready'
        ? { ...inspected, status: 'failed', error: previous.error, environment: this.resourceEnvironment.steps }
        : inspected
      return this.snapshot(this.resourceState)
    }
    if (this.resourceState && JSON.stringify(this.resourceState.selections) !== JSON.stringify(selections)) {
      inspected.activePreparation = { selections: this.resourceState.selections, status: this.resourceState.status, ...(this.resourceState.error ? { error: this.resourceState.error } : {}) }
      inspected.entries = mergeResourceEntries(inspected.entries ?? [], this.snapshot(this.resourceState).entries)
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
    const selections = this.selections(value)
    if (this.resourceJob) {
      if (JSON.stringify(this.resourceState!.selections) !== JSON.stringify(selections)) throw new AppError('RESOURCE_PREPARATION_BUSY', '其他工作流依赖正在准备。', 409)
      return this.checkResources(selections)
    }
    const initial = await this.inspectResources(selections)
    const manual = initial.requirements.filter(item => !item.ready && !item.automatic)
    if (manual.length) throw new AppError('MANUAL_RESOURCE_REQUIRED', manual.map(item => `${item.providerId}: ${item.reason}`).join('\n'), 422)
    if (initial.status === 'ready') { this.resourceState = initial; return initial }
    this.resourceState = { ...initial, status: 'preparing' }
    const controller = new AbortController()
    this.resourceEnvironment = new EnvironmentSetup(this.ctx, this.config, this.client, AbortSignal.any([this.stopping.signal, controller.signal]))
    this.resourceJob = this.runJob('准备工作流资源', controller, async () => {
      await this.resourceEnvironment.prepare(this.groups(selections))
      for (const model of this.resourceState!.models) if (!['ready', 'paused'].includes(model.status)) this.download(model.id)
      while (this.jobs.size) await Promise.all([...this.jobs.values()].map(job => job.promise))
      const failed = this.resourceState!.models.find(model => model.status === 'failed')
      if (failed) throw new Error(`${failed.name}: ${failed.error}`)
      if (this.resourceState!.models.some(model => model.status !== 'ready')) {
        this.resourceState = { ...await this.inspectResources(selections), environment: this.resourceEnvironment.steps }
        return
      }
      await this.resourceEnvironment.probe('verify', this.groups(selections))
      const final = await this.inspectResources(selections)
      this.resourceState = { ...final, environment: this.resourceEnvironment.steps }
      if (final.status !== 'ready') throw new Error(final.requirements.filter(item => !item.ready).map(item => `${item.providerId}: ${item.reason}`).join('\n'))
    }).catch(error => {
      if (cancelled(error, this.stopping.signal)) return
      this.resourceState!.status = 'failed'; this.resourceState!.error = message(error); this.resourceState!.environment = this.resourceEnvironment.steps
      this.ctx.logger.error(error)
    }).finally(() => { this.resourceJob = undefined })
    return this.snapshot({ ...this.resourceState, environment: this.resourceEnvironment.steps })
  }
  private root(id: string) {
    return this.config.modelRoots[id]!
  }
  private download(id: string) {
    if (this.jobs.has(id)) return
    const model = this.models.find(item => item.id === id)!
    const definition = modelManifest.find(item => item.id === id)!
    const controller = new AbortController()
    const signal = AbortSignal.any([this.stopping.signal, controller.signal])
    model.status = 'downloading'; model.error = undefined; model.source = undefined; model.log = ''
    const log = (text: string) => {
      const line = `${new Date().toISOString()} ${text}\n`
      const output = (model.log || '').replace(/^\[较早日志已省略\]\n/, '') + line
      model.log = output.length > 64 * 1024 ? '[较早日志已省略]\n' + output.slice(-64 * 1024) : output
      this.ctx.logger.info(line.trim())
    }
    const promise = this.runJob(`下载 ${model.name}`, controller, async () => {
      let completed = 0, previousBytes = 0, previousTime = Date.now()
      for (const file of definition.files) {
        let firstProgress = true, loggedAt = 0
        await this.client.download({ ...file, sourceGroup: id }, join(this.root(id), file.path), signal, bytes => {
          model.received = completed + bytes
          if (firstProgress) { previousBytes = model.received; previousTime = Date.now(); firstProgress = false }
          const elapsed = (Date.now() - previousTime) / 1000
          if (elapsed >= 0.5) { model.speed = Math.max(0, (model.received - previousBytes) / elapsed); previousBytes = model.received; previousTime = Date.now() }
          if (bytes > 0 && (Date.now() - loggedAt >= 1000 || bytes === file.size)) {
            log(`${file.path}: ${(bytes / 1e6).toFixed(1)} / ${(file.size / 1e6).toFixed(1)} MB (${Math.floor(bytes / file.size * 100)}%)`)
            loggedAt = Date.now()
          }
        }, event => {
          model.source = sourceName(event.url)
          log(event.status === 'failed' ? event.error! : `${event.status === 'checking' ? '测试下载源' : '下载'}：${model.source} · ${file.path}`)
        })
        log(`下载及校验完成：${file.path}`)
        completed += file.size
        previousBytes = completed; previousTime = Date.now()
      }
      model.status = 'ready'
    }).catch(error => {
      if (cancelled(error, signal)) model.status = 'paused'
      else { model.status = 'failed'; model.error = message(error); this.ctx.logger.error(error) }
    }).finally(() => { model.speed = 0; this.jobs.delete(id) })
    this.jobs.set(id, { controller, promise })
  }
}

export function registerResourceRoutes(ctx: any, http: any) {
  const route = (method: string, path: string, handler: any) => ctx.effect(() => http.register(method, path, handler))
  route('GET', '/api/v2/resources', async request => http.json(request, 200, await ctx.youdubResources.resourceInventory()))
  for (const action of ['check', 'prepare'] as const) {
    route('POST', `/api/v2/resources/${action}`, async request => {
      const { selections, resourceIds } = await readJson(request)
      if (selections && resourceIds) throw new AppError('INVALID_INPUT', '资源选择不能同时包含 selections 和 resourceIds。', 422)
      const selected = resourceIds ? await ctx.youdubResources.resourceTargets(resourceIds) : ctx.youdubResources.catalogSelections(selections)
      http.json(request, 200, await ctx.youdubResources[action === 'check' ? 'checkResources' : 'prepareResources'](selected))
    })
    route('POST', `/api/v2/workflow-documents/resources/${action}`, async request => {
      const { document: raw } = await readJson(request)
      const document = parseWorkflowDocument(raw), types = nodeTypes(ctx.catalog)
      const selections = document.nodes.map(node => {
        if (!types.some(type => type.type === node.type && type.version === node.typeVersion && type.providerId === node.provider.id)) throw new AppError('NODE_TYPE_UNAVAILABLE', `节点 ${node.id} 的类型、版本或供应商不可用。`, 422)
        return { providerId: node.provider.id, model: node.provider.model }
      })
      http.json(request, 200, await ctx.youdubResources[action === 'check' ? 'checkResources' : 'prepareResources'](selections))
    })
  }
  route('POST', '/api/v2/resources/action', async request => {
    const { action, id, resourceId } = await readJson(request)
    if (resourceId && action === 'retry') await ctx.youdubResources.prepareResources(await ctx.youdubResources.resourceTargets([resourceId]))
    else await ctx.youdubResources.resourceAction(action, id || resourceId)
    http.json(request, 200, await ctx.youdubResources.resourceInventory())
  })
}
