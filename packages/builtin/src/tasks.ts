import { Service, type Context } from 'cordis'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import Ajv from 'ajv/dist/2020.js'
import { setTimeout as delay } from 'node:timers/promises'
import {
  AppError, requireId, type TasksService, type TaskRecord, type TaskView, type TaskQuery, type CreateTask,
  type JsonObject, type WorkflowPlan, type StepState, type Invocation, type InvocationContext, type ArtifactRef,
} from '@youdub/sdk'
import { taskCover } from './task-cover.js'

const terminal = new Set(['succeeded', 'failed', 'cancelled'])
const now = () => new Date().toISOString()
const validator = new Ajv({ allErrors: true, strict: false })
function validate(schema: JsonObject, value: unknown, label: string, code = 'INVALID_CONFIG') {
  if (!validator.validate(schema, value)) throw new AppError(code, `${label}: ${validator.errorsText()}`, code === 'INVALID_CONFIG' ? 422 : 500)
}
function redact(message: string, credentials: InvocationContext['credentials'] = {}) {
  for (const value of Object.values(credentials)) if (value.api_key) message = message.replaceAll(value.api_key, '[redacted]')
  return message.replace(/(authorization|api[_-]?key|cookie)\s*[:=]\s*[^\r\n]+/gi, '$1: [redacted]')
}
function ref(value: any): value is ArtifactRef { return value && typeof value.id === 'string' && typeof value.schemaId === 'string' && Object.keys(value).length === 2 }

export default class Tasks extends Service implements TasksService {
  static inject = ['catalog', 'store', 'files', 'settings']
  private mutation = Promise.resolve()
  private stopping = new AbortController()
  private active?: { id: string; controller: AbortController }
  private running?: Promise<void>
  private fatal?: Error
  constructor(ctx: Context, private config: { pollMs?: number } = {}) {
    super(ctx, 'tasks')
    ctx.on('app/ready', () => {
      this.running = this.loop()
      void this.running.catch(error => { this.fatal = error; ctx.logger.error(error) })
    })
    ctx.on('app/stopping', () => this.stop())
    ctx.effect(() => () => this.stop())
  }
  private async locked<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.mutation
    let release!: () => void
    this.mutation = new Promise(resolve => { release = resolve }); await previous
    try { return await action() } finally { release() }
  }
  assertReady() { if (this.fatal) throw new AppError('TASK_RUNTIME_UNAVAILABLE', this.fatal.message, 503); if (this.stopping.signal.aborted) throw new AppError('APP_STOPPING', 'Application is stopping.', 503) }
  async record(id: string): Promise<TaskRecord> {
    requireId(id)
    const task = await this.ctx.store.call<TaskRecord | null>('store.get', { id })
    if (!task) throw new AppError('TASK_NOT_FOUND', 'Task not found.', 404)
    return task
  }
  private view(task: TaskRecord): TaskView {
    const { artifacts, credentialRefs, rawSnapshot, ...publicTask } = task
    const mayStillRun = Object.values(task.externalRequests ?? {}).some(value => value.mayStillRun)
    const allowedActions = terminal.has(task.status) ? ['rerun', 'delete'] : ['cancel']
    if (!task.legacy && ['failed', 'cancelled'].includes(task.status) && !mayStillRun) allowedActions.unshift('retry')
    return {
      ...publicTask, mayStillRun, allowedActions,
      ...(taskCover(task) ? { cover: {} } : {}),
      outputs: (task.outputs ?? []).map(output => {
        const file = artifacts?.[output.artifact.id]
        if (!file) throw new AppError('OUTPUT_MISSING', `Output artifact missing: ${output.artifact.id}`, 500)
        return { id: output.id, label: output.label, role: output.role, name: file.name, mimeType: file.mimeType, size: file.size }
      }),
    }
  }
  async get(id: string) { return this.view(await this.record(id)) }
  async list(query: TaskQuery = {}) {
    const page = await this.ctx.store.call('store.list', { limit: query.limit ?? 30, offset: query.offset ?? 0, ...query })
    return { ...page, items: page.items.map((task: TaskRecord) => this.view(task)) }
  }
  private async save(task: TaskRecord) {
    task.updatedAt = now()
    const saved = await this.ctx.store.call<TaskRecord>('store.cas', { id: task.id, expectedRevision: task.revision, task })
    return saved
  }
  private async change(id: string, action: (task: TaskRecord) => Promise<void> | void) {
    return this.locked(async () => { const task = await this.record(id); await action(task); return this.save(task) })
  }
  private checkPlan(plan: WorkflowPlan) {
    const ids = new Set<string>()
    const workflow = this.ctx.catalog.workflow(plan.workflow.id)
    if (['version', 'pluginId', 'pluginVersion', 'integrity'].some(key => workflow[key as keyof typeof workflow] !== plan.workflow[key as keyof typeof plan.workflow])) throw new AppError('WORKFLOW_VERSION_UNAVAILABLE', 'Pinned workflow is unavailable.', 409)
    if (!plan.steps.length) throw new AppError('INVALID_PLAN', 'Workflow plan has no steps.', 422)
    for (const step of plan.steps) {
      if (!step.id || ids.has(step.id)) throw new AppError('INVALID_PLAN', 'Step IDs must be unique.', 422)
      const binding = plan.bindings[step.bindingKey]
      if (!binding) throw new AppError('INVALID_PLAN', `Missing binding ${step.bindingKey}`, 422)
      const provider = this.ctx.catalog.provider(binding.providerId).describe()
      if (provider.pluginId !== binding.pluginId || provider.pluginVersion !== binding.pluginVersion || provider.integrity !== binding.integrity) throw new AppError('PLUGIN_VERSION_UNAVAILABLE', `Pinned provider ${binding.providerId} is unavailable.`, 409)
      const operation = provider.operations.find(item => item.id === step.operation)
      if (!operation) throw new AppError('INVALID_PLAN', `Provider does not support ${step.operation}.`, 422)
      if (new Set(step.outputs.map(port => port.name)).size !== step.outputs.length) throw new AppError('INVALID_PLAN', 'Output port names must be unique.', 422)
      for (const declared of operation.outputs) {
        if (declared.required && !step.outputs.some(port => port.name === declared.name && port.required)) throw new AppError('INVALID_PLAN', `Required provider output ${step.id}.${declared.name} is missing.`, 422)
      }
      for (const input of Object.values(step.input)) {
        if (input?.from === 'step') {
          const upstream = plan.steps.find(item => item.id === input.stepId)
          if (!ids.has(input.stepId) || !upstream?.outputs.some(port => port.name === input.output)) throw new AppError('INVALID_PLAN', 'Input references an unavailable earlier output.', 422)
        }
      }
      for (const output of step.outputs) {
        const declared = operation.outputs.find(port => port.name === output.name)
        if (!declared || declared.kind !== output.kind || declared.schemaId !== output.schemaId) throw new AppError('INVALID_PLAN', `Incompatible output ${step.id}.${output.name}.`, 422)
        if (output.kind === 'json' && (!output.schema || !declared.schema || !isDeepStrictEqual(output.schema, declared.schema))) throw new AppError('INVALID_PLAN', `JSON output ${step.id}.${output.name} requires its declared schema.`, 422)
      }
      ids.add(step.id)
    }
    const outputIds = new Set<string>()
    for (const output of plan.outputs) {
      const step = plan.steps.find(item => item.id === output.source.stepId)
      if (outputIds.has(output.id) || !step?.outputs.some(port => port.name === output.source.output && port.kind === 'artifact')) throw new AppError('INVALID_PLAN', 'Final outputs must select unique artifact ports.', 422)
      outputIds.add(output.id)
    }
  }
  async create(request: CreateTask) {
    this.assertReady(); requireId(request.id)
    return this.ctx.settings.locked(async () => {
      const workflow = this.ctx.catalog.workflow(request.workflowId)
      if (request.workflowVersion && request.workflowVersion !== workflow.version) throw new AppError('WORKFLOW_VERSION_UNAVAILABLE', 'Selected workflow version is unavailable.', 409)
      const description = workflow.describe()
      validate(description.configSchema, request.config, 'Workflow configuration')
      const artifacts = request.artifacts ?? {}
      for (const slot of description.inputs) {
        const input = request.inputs[slot.name], artifact = input && artifacts[input.id]
        if (!input && !slot.required) continue
        if (!artifact || artifact.invocationId !== 'input') throw new AppError('INPUT_MISSING', `Input ${slot.name} is required.`, 422)
        if (artifact.size > slot.maxBytes) throw new AppError('FILE_TOO_LARGE', `Input ${slot.name} exceeds its limit.`, 413)
        await this.ctx.files.resolve(request.id, artifact)
      }
      if (Object.keys(request.inputs).some(key => !description.inputs.some(slot => slot.name === key))) throw new AppError('INVALID_CONFIG', 'Unknown workflow input slot.', 422)
      const diagnostics = await workflow.validate(request.inputs, request.config, this.ctx.catalog)
      if (diagnostics.length) throw new AppError(diagnostics[0].code, diagnostics[0].message, 422, diagnostics)
      const plan = await workflow.plan(request.inputs, request.config, this.ctx.catalog); this.checkPlan(plan)
      const snapshot = await this.ctx.settings.snapshot()
      const remote = new Set(Object.values(plan.bindings).map(binding => this.ctx.catalog.provider(binding.providerId).describe()).filter(provider => provider.execution === 'remote').map(provider => provider.adapter ?? provider.id))
      const connections = snapshot.connections.filter(connection => remote.has(connection.adapter))
      const credentialRefs = Object.fromEntries(Object.entries(snapshot.credentialRefs).filter(([adapter]) => remote.has(adapter)))
      const timestamp = now()
      const task: TaskRecord = {
        id: request.id, revision: 0, attempt: 1, status: 'queued', sourceName: request.sourceName ?? Object.values(artifacts)[0]?.name ?? description.label,
        workflowId: workflow.id, workflowVersion: workflow.version, config: plan.config, plan, inputs: request.inputs, artifacts,
        steps: plan.steps.map(step => ({ id: step.id, label: step.label, status: 'pending', invocationId: null, progress: null, message: null, startedAt: null, finishedAt: null, outputs: {}, error: null })),
        outputs: [], connections, credentialRefs, externalRequests: {}, error: null, message: null,
        createdAt: timestamp, updatedAt: timestamp, queuedAt: timestamp, startedAt: null, finishedAt: null, nextPollAt: null,
      }
      await this.ctx.settings.credentials(task)
      return this.view(await this.ctx.store.call('store.create', { task }))
    })
  }
  private expected(task: TaskRecord, attempt: number) { if (task.attempt !== attempt) throw new AppError('ATTEMPT_CONFLICT', 'Task attempt changed. Refresh before acting.', 409) }
  async cancel(id: string, expectedAttempt: number) {
    this.assertReady()
    const task = await this.change(id, task => {
      this.expected(task, expectedAttempt)
      if (terminal.has(task.status)) throw new AppError('TASK_BUSY', 'Task has already stopped.', 409)
      if (task.status === 'queued' && this.active?.id !== id) { task.status = 'cancelled'; task.finishedAt = now() }
      else task.status = 'cancelling'
    })
    if (this.active?.id === id) this.active.controller.abort(new AppError('CANCELLED', 'Task cancellation requested.', 409))
    return this.view(task)
  }
  async retry(id: string, expectedAttempt: number) {
    this.assertReady()
    const release = await this.ctx.files.reserve(id)
    try {
      return this.view(await this.change(id, task => {
        this.expected(task, expectedAttempt)
        if (task.legacy || !['failed', 'cancelled'].includes(task.status)) throw new AppError('RETRY_NOT_ALLOWED', 'This task cannot be retried.', 409)
        if (Object.values(task.externalRequests).some(item => item.mayStillRun)) throw new AppError('EXTERNAL_RESULT_UNKNOWN', 'A remote request may still be running.', 409)
        this.checkPlan(task.plan)
        task.attempt++; task.status = 'queued'; task.queuedAt = now(); task.startedAt = task.finishedAt = task.nextPollAt = null
        task.error = null; task.message = null; task.outputs = []; task.externalRequests = {}
        task.steps = task.steps.map(step => ({ ...step, status: 'pending', invocationId: null, progress: null, message: null, startedAt: null, finishedAt: null, outputs: {}, error: null, operation: undefined }))
      }))
    } finally { await release() }
  }
  async rerun(id: string, request: { id: string; config: JsonObject; workflowId?: string; acknowledgeExternalRisk?: boolean }) {
    this.assertReady()
    const source = await this.record(id)
    if (source.legacy && !request.workflowId) throw new AppError('WORKFLOW_REQUIRED', 'Select a current workflow to rerun a historical task.', 422)
    if (!terminal.has(source.status)) throw new AppError('TASK_BUSY', 'Stop the source task before rerunning.', 409)
    if (Object.values(source.externalRequests ?? {}).some(item => item.mayStillRun) && !request.acknowledgeExternalRisk) throw new AppError('EXTERNAL_RESULT_UNKNOWN', 'Acknowledge the previous remote request before rerunning.', 409)
    const readRelease = this.ctx.files.readLock(id)
    let writeRelease: (() => void | Promise<void>) | undefined
    try {
      writeRelease = await this.ctx.files.reserve(request.id, true)
      const inputs = await this.ctx.files.copyInputs(source, request.id)
      return await this.create({ id: request.id, workflowId: request.workflowId ?? source.workflowId, config: request.config, sourceName: source.sourceName, ...inputs })
    } finally { try { await writeRelease?.() } finally { readRelease() } }
  }
  async delete(id: string, expectedAttempt: number) {
    this.assertReady()
    const release = await this.ctx.files.reserve(id)
    try {
      await this.locked(async () => {
        const task = await this.record(id); this.expected(task, expectedAttempt)
        if (!terminal.has(task.status)) throw new AppError('TASK_BUSY', 'Stop the task before deleting.', 409)
        await this.ctx.files.remove(id)
        await this.ctx.store.call('store.delete', { id, expectedRevision: task.revision })
      })
    } finally { await release() }
  }
  async idle() { return !(await this.ctx.store.call('store.list', { active: true, limit: 1, offset: 0 })).items.length }
  private async stop() {
    this.stopping.abort(); this.active?.controller.abort(new AppError('APP_INTERRUPTED', 'Application shutdown interrupted this task.', 503))
    if (this.running) await this.running
  }
  private async loop() {
    // A previous process owns no live computation here. Preserve the failure,
    // including external uncertainty, instead of rerunning the interrupted step.
    for (const status of ['running', 'cancelling']) {
      const page = await this.ctx.store.call('store.list', { status, limit: 1000, offset: 0 })
      for (const record of page.items) await this.change(record.id, task => {
        task.status = 'failed'; task.finishedAt = now(); task.error = { code: 'APP_INTERRUPTED', message: 'Application stopped before this attempt completed.' }
        for (const request of Object.values(task.externalRequests)) if (request.mayStillRun) request.state = 'unknown'
        for (const step of task.steps) if (['running', 'waiting'].includes(step.status)) { step.status = 'failed'; step.error = task.error; step.finishedAt = now() }
      })
    }
    while (!this.stopping.signal.aborted) {
      const task = await this.locked(() => this.ctx.store.call<TaskRecord | null>('store.claim', { statuses: ['queued', 'waiting'], now: now() }))
      if (task) await this.execute(task)
      else {
        const cancelling = await this.ctx.store.call('store.list', { status: 'cancelling', limit: 1000, offset: 0 })
        for (const record of cancelling.items) await this.change(record.id, task => {
          task.status = 'cancelled'; task.finishedAt = now(); task.nextPollAt = null
          for (const step of task.steps) if (['running', 'waiting'].includes(step.status)) { step.status = 'cancelled'; step.finishedAt = task.finishedAt }
          for (const request of Object.values(task.externalRequests)) if (request.mayStillRun) request.state = 'unknown'
        })
        try { await delay(this.config.pollMs ?? 300, undefined, { signal: this.stopping.signal }) }
        catch (error) { if (!this.stopping.signal.aborted) throw error }
      }
    }
  }
  private async execute(initial: TaskRecord) {
    const controller = new AbortController(); this.active = { id: initial.id, controller }
    let credentials: InvocationContext['credentials'] = {}, currentStep: StepState | undefined
    const invocationArtifacts: TaskRecord['artifacts'] = {}
    try {
      this.checkPlan(initial.plan)
      currentStep = initial.steps.find(step => step.status !== 'completed')
      if (!currentStep) throw new AppError('INVALID_PLAN', 'Claimed task has no pending step.', 500)
      const spec = initial.plan.steps.find(step => step.id === currentStep!.id)!, binding = initial.plan.bindings[spec.bindingKey]
      const provider = this.ctx.catalog.provider(binding.providerId)
      const invocationId = currentStep.invocationId && currentStep.status === 'waiting' ? currentStep.invocationId : randomUUID()
      const workDir = await this.ctx.files.workDir(initial.id, initial.attempt, invocationId)
      const started = await this.change(initial.id, task => {
        if (task.status !== 'running' || task.attempt !== initial.attempt) throw new AppError('STALE_INVOCATION', 'Task no longer owns this execution.', 409)
        const step = task.steps.find(step => step.id === spec.id)!
        step.status = 'running'; step.invocationId = invocationId; step.startedAt ??= now(); task.startedAt ??= now()
      })
      const inputs: JsonObject = {}
      for (const [key, value] of Object.entries(spec.input)) {
        inputs[key] = value?.from === 'task' ? started.inputs[value.name] : value?.from === 'step' ? started.steps.find(step => step.id === value.stepId)?.outputs[value.output] : value
        if (inputs[key] === undefined) throw new AppError('INPUT_MISSING', `Input ${spec.id}.${key} is missing.`, 500)
      }
      validate(provider.describe().operations.find(operation => operation.id === spec.operation)!.inputSchema, inputs, spec.operation)
      const description = provider.describe(), adapter = description.adapter ?? description.id
      const availableCredentials = await this.ctx.settings.credentials(started)
      credentials = description.execution === 'remote' && availableCredentials[adapter] ? { [adapter]: availableCredentials[adapter] } : {}
      const update = (action: (task: TaskRecord, step: StepState) => void | Promise<void>, receipt = false) => this.change(initial.id, task => {
        const step = task.steps.find(step => step.id === spec.id)!
        if (task.attempt !== initial.attempt || step.invocationId !== invocationId || !(['running', ...(receipt ? ['cancelling'] : [])].includes(task.status))) throw new AppError('STALE_INVOCATION', 'Task no longer accepts this invocation.', 409)
        return action(task, step)
      })
      const invocation: Invocation = { invocationId, taskId: initial.id, attempt: initial.attempt, stepId: spec.id, operation: spec.operation, binding, inputs, workDir, taskDir: this.ctx.files.taskRoot(initial.id), config: started.config }
      const context: InvocationContext = {
        signal: controller.signal, credentials,
        progress: async (value, message) => {
          controller.signal.throwIfAborted()
          if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) throw new AppError('PROTOCOL_ERROR', 'Invalid progress.', 500)
          const safe = redact(message, credentials)
          await this.ctx.files.log(initial.id, `[${spec.id}] ${safe}`)
          await update((task, step) => { step.progress = value; step.message = safe; task.message = safe })
        },
        externalPrepare: async request => {
          controller.signal.throwIfAborted()
          await update(task => {
            if (!request.externalRequestId || !request.requestKey || task.externalRequests[request.externalRequestId]) throw new AppError('PROTOCOL_ERROR', 'External request ID must be unique.', 500)
            task.externalRequests[request.externalRequestId] = { ...request, externalRequestId: request.externalRequestId, requestKey: request.requestKey, state: 'pending', mayStillRun: true }
          })
        },
        externalUpdate: async request => { await update(task => {
          const saved = task.externalRequests[request.externalRequestId]
          if (!saved || request.requestKey && request.requestKey !== saved.requestKey) throw new AppError('PROTOCOL_ERROR', 'Unknown external request receipt.', 500)
          task.externalRequests[request.externalRequestId] = { ...saved, ...request }
        }, true) },
        register: async descriptor => {
          const artifact = await this.ctx.files.register(initial.id, invocationId, workDir, descriptor)
          invocationArtifacts[artifact.id] = artifact
          return { id: artifact.id, schemaId: artifact.schemaId }
        },
        resolve: async reference => {
          const artifact = invocationArtifacts[reference.id] ?? started.artifacts[reference.id]
          if (!artifact || artifact.schemaId !== reference.schemaId) throw new AppError('INPUT_MISSING', 'Unregistered artifact reference.', 500)
          return this.ctx.files.resolve(initial.id, artifact)
        },
      }
      const result = currentStep.status === 'waiting' && currentStep.operation
        ? await (provider.poll ? provider.poll(currentStep.operation, context) : Promise.reject(new AppError('POLL_UNSUPPORTED', 'Pinned provider does not support polling.', 500)))
        : await provider.execute(invocation, context)
      controller.signal.throwIfAborted()
      if (result.state === 'waiting') {
        if (!provider.poll || !result.operation || !Number.isFinite(Date.parse(result.nextPollAt))) throw new AppError('INVALID_PROVIDER_RESULT', 'Invalid asynchronous operation.', 500)
        await update((task, step) => { task.status = 'waiting'; task.nextPollAt = new Date(result.nextPollAt).toISOString(); step.status = 'waiting'; step.operation = result.operation })
        return
      }
      if (result.state !== 'completed' || !result.outputs) throw new AppError('INVALID_PROVIDER_RESULT', 'Invalid operation result.', 500)
      const verifyReferences = async (value: any): Promise<void> => {
        if (ref(value)) {
          const artifact = invocationArtifacts[value.id] ?? started.artifacts[value.id]
          if (!artifact || artifact.schemaId !== value.schemaId) throw new AppError('INVALID_PROVIDER_RESULT', 'Artifact reference does not match its registration.', 500)
          await this.ctx.files.resolve(initial.id, artifact)
        } else if (Array.isArray(value)) { for (const item of value) await verifyReferences(item) }
        else if (value && typeof value === 'object') { for (const item of Object.values(value)) await verifyReferences(item) }
      }
      for (const output of spec.outputs) {
        const value = result.outputs[output.name]
        if (value === undefined) { if (output.required) throw new AppError('STAGE_OUTPUT_MISSING', `Missing ${spec.id}.${output.name}.`, 500); continue }
        if (output.kind === 'artifact' && (!ref(value) || value.schemaId !== output.schemaId || !invocationArtifacts[value.id])) throw new AppError('INVALID_PROVIDER_RESULT', `Invalid artifact port ${output.name}.`, 500)
        if (output.kind === 'json') validate(output.schema!, value, `${spec.id}.${output.name}`, 'INVALID_PROVIDER_RESULT')
      }
      await verifyReferences(result.outputs)
      await this.ctx.files.log(initial.id, `[${spec.id}] completed`)
      await update(async (task, step) => {
        Object.assign(task.artifacts, invocationArtifacts)
        step.status = 'completed'; step.outputs = result.outputs; step.progress = 1; step.finishedAt = now(); task.nextPollAt = null
        if (task.steps.every(step => step.status === 'completed')) {
          task.outputs = []
          for (const output of task.plan.outputs) {
            const artifact = task.steps.find(step => step.id === output.source.stepId)!.outputs[output.source.output]
            if (!artifact) { if (output.required) throw new AppError('STAGE_OUTPUT_MISSING', `Missing final output ${output.id}.`, 500); continue }
            if (!ref(artifact) || !task.artifacts[artifact.id]) throw new AppError('INVALID_PROVIDER_RESULT', 'Final output is not a registered artifact.', 500)
            if (task.artifacts[artifact.id].schemaId !== artifact.schemaId) throw new AppError('INVALID_PROVIDER_RESULT', 'Final output schema differs from its registration.', 500)
            await this.ctx.files.resolve(task.id, task.artifacts[artifact.id])
            task.outputs.push({ id: output.id, label: output.label, role: output.role, artifact })
          }
          task.status = 'succeeded'; task.finishedAt = now(); task.message = 'Completed.'
        } else task.status = 'queued'
      })
    } catch (error: any) {
      if (['COMMIT_OUTCOME_UNKNOWN', 'STORE_UNAVAILABLE', 'PROTOCOL_ERROR'].includes(error.code) && error.status === 503) throw error
      const message = redact(error.message ?? String(error), credentials)
      await this.ctx.files.log(initial.id, `[${currentStep?.id ?? 'task'}] ${redact(error.stack ?? message, credentials)}`)
      await this.change(initial.id, task => {
        if (task.attempt !== initial.attempt) throw new AppError('STALE_INVOCATION', 'Failure belongs to an older attempt.', 409)
        if (error.code === 'CANCEL_TIMEOUT') {
          task.status = 'cancelling'; task.finishedAt = null; task.error = { code: error.code, message }; task.message = message
          return
        }
        const cancelled = task.status === 'cancelling'
        task.status = cancelled ? 'cancelled' : 'failed'; task.finishedAt = now(); task.message = message
        task.error = cancelled ? null : { code: error.code ?? 'WORKER_ERROR', message }
        for (const request of Object.values(task.externalRequests)) if (request.mayStillRun) request.state = 'unknown'
        const step = task.steps.find(step => step.id === currentStep?.id)
        if (step) { step.status = cancelled ? 'cancelled' : 'failed'; step.error = task.error; step.finishedAt = now() }
      })
      if (error.code === 'CANCEL_TIMEOUT') throw error
    } finally { this.active = undefined }
  }
}
