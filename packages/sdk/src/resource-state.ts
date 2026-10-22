/** Resource availability shared by setup, the inventory and workflow preparation. */
export type ResourceStatus = 'unchecked' | 'checking' | 'missing' | 'preparing' | 'paused' | 'ready' | 'failed' | 'blocked'
export type ResourcePhase = 'waiting' | 'downloading' | 'installing' | 'verifying'
export type ResourceAction = 'prepare' | 'pause' | 'resume' | 'retry'
export interface ResourceEntry {
  id: string; name: string; variant?: string; group: 'environment' | 'model'; status: ResourceStatus
  phase?: ResourcePhase; actions: ResourceAction[]; dependencies: string[]
  detail?: string; error?: string; source?: string; downloadId?: string
  progress?: { received: number; total: number; speed?: number }
}
export interface ResourceStep {
  id: string; name: string; status: string; detail?: string; source?: string
  phase?: ResourcePhase; progress?: ResourceEntry['progress']
}
export interface ResourceModel {
  id: string; name: string; variant?: string; status: string; error?: string; source?: string
  received?: number; total?: number; speed?: number
}
export interface ResourceNeed {
  providerId: string; model?: string; ready: boolean; automatic: boolean; reason?: string
  resourceId?: string; name?: string; dependencies?: string[]; downloadId?: string; configurationRequired?: boolean; remote?: boolean
}
export interface ResourceFacts {
  status?: string; environment?: ResourceStep[]; models?: ResourceModel[]; requirements?: ResourceNeed[]
  error?: string; entries?: ResourceEntry[]
}
const names: Record<string, string> = { python: 'Python', acceleration: '推理运行库', ffmpeg: 'FFmpeg', resources: '分句资源' }

export function resourceEntries(facts: ResourceFacts): ResourceEntry[] {
  const steps = facts.environment ?? [], models = facts.models ?? []
  const running = facts.status === 'preparing'
  const failedStep = steps.find(step => step.status === 'failed')
  const dependencies = steps.find(step => step.id === 'dependencies')
  const entries: ResourceEntry[] = steps.filter(step => step.id !== 'dependencies').map(step => {
    const status: ResourceStatus = step.status === 'failed' ? 'failed' : step.status === 'ready' ? 'ready'
      : running ? failedStep ? 'blocked' : 'preparing' : 'missing'
    return { id: step.id, name: names[step.id] || step.name, group: 'environment', status,
      dependencies: step.id === 'python' ? [] : ['python'], actions: [],
      ...(status === 'preparing' ? { phase: step.status === 'running' ? step.phase || 'installing' : 'waiting' } : {}),
      detail: step.detail, source: step.source, progress: step.progress,
      ...(status === 'failed' ? { error: step.detail } : {}) }
  })
  // Bootstrap has no providers yet. Its dependency step belongs to Python.
  if (!facts.requirements?.length && dependencies) {
    const python = entries.find(entry => entry.id === 'python')
    if (python && dependencies.status !== 'ready' && python.status === 'ready') {
      python.status = dependencies.status === 'failed' ? 'failed' : running ? 'preparing' : 'missing'
      python.phase = 'installing'; python.detail = dependencies.detail
      if (python.status === 'failed') python.error = dependencies.detail
    }
  }
  for (const need of facts.requirements ?? []) {
    if (need.remote || need.configurationRequired || !need.resourceId) continue
    const model = models.find(model => model.id === need.downloadId)
    const previous = entries.find(entry => entry.id === need.resourceId)
    const deps = need.dependencies ?? []
    const failedDependency = entries.find(entry => deps.includes(entry.id) && ['failed', 'blocked'].includes(entry.status))
    const installing = dependencies?.status === 'running'
    const installFailed = dependencies?.status === 'failed' && !need.ready
    let status: ResourceStatus = need.ready ? 'ready' : 'missing'
    let phase: ResourcePhase | undefined
    if (model?.status === 'failed') status = 'failed'
    else if (model?.status === 'paused') status = 'paused'
    else if (previous?.status === 'failed') status = 'failed'
    else if (failedDependency || installFailed) status = 'blocked'
    else if (facts.status === 'failed' && facts.error && !need.ready) status = 'failed'
    else if (running && !need.ready) {
      status = 'preparing'
      phase = model?.status === 'downloading' ? 'downloading' : previous?.phase && previous.status === 'preparing' ? previous.phase : installing ? 'installing'
        : steps.every(step => step.status === 'ready') && (!model || model.status === 'ready') ? 'verifying' : 'waiting'
    }
    const entry: ResourceEntry = {
      ...previous, id: need.resourceId, name: names[need.resourceId] || need.name || model?.name || need.providerId,
      group: model || need.model ? 'model' : 'environment', status, phase, actions: [], dependencies: deps,
      variant: model ? model.variant : need.model,
      detail: need.reason || previous?.detail,
      error: model?.error || previous?.error || failedDependency?.error || (installFailed ? dependencies?.detail : status === 'failed' ? facts.error : undefined),
      ...(model ? { downloadId: model.id, source: model.source, progress: { received: model.received ?? 0, total: model.total ?? 0, speed: model.speed } } : {}),
    }
    if (need.automatic) {
      if (model?.status === 'downloading') entry.actions = ['pause']
      else if (model?.status === 'paused') entry.actions = ['resume']
      else if (!running || model && steps.every(step => step.status === 'ready')) {
        if (status === 'failed' || status === 'blocked') entry.actions = ['retry']
        else if (status === 'missing') entry.actions = ['prepare']
      }
    }
    if (previous) entries[entries.indexOf(previous)] = entry
    else entries.push(entry)
  }
  // Shared dependencies can be prepared directly even when only a model selected them.
  for (const entry of entries) {
    if (entry.group === 'environment' && entry.id in names && !running && !entry.actions.length) {
      if (entry.status === 'missing') entry.actions = ['prepare']
      if (entry.status === 'failed' || entry.status === 'blocked') entry.actions = ['retry']
    }
  }
  return entries
}

/** Overlay only the resources owned by the current Host preparation. */
export function mergeResourceEntries(inspected: ResourceEntry[], active?: ResourceEntry[]): ResourceEntry[] {
  const current = new Map(active?.filter(entry => !['ready', 'missing'].includes(entry.status)).map(entry => [entry.id, entry]))
  return inspected.map(entry => current.get(entry.id) ?? entry)
}
