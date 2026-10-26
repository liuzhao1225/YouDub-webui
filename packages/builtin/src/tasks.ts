import { Service, type Context } from 'cordis'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import Ajv from 'ajv/dist/2020.js'
import { setTimeout as delay } from 'node:timers/promises'
import {
  AppError, requireId, type TasksService, type TaskRecord, type TaskView, type TaskSummary, type TaskQuery, type CreateTask,
  type Diagnostic, type JsonObject, type WorkflowPlan, type StepState, type Invocation, type InvocationContext, type ArtifactRef,
  type StepSpec, type WorkflowDocument, type ReviewCommand, type NodeActionReceipt, type RerunTask,
} from '@youdub/sdk'
import { taskCover } from './task-cover.js'
import { parseWorkflowDocument } from './workflow-document.js'
import { nodeTypes } from './workflow-graph.js'

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
function safeDetails(value: any, credentials: InvocationContext['credentials']): any {
  if (typeof value === 'string') return redact(value, credentials)
  if (Array.isArray(value)) return value.map(item => safeDetails(item, credentials))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /api[_-]?key|password|credential|authorization|secret|cookie/i.test(key) ? '[redacted]' : safeDetails(item, credentials)]))
  return value
}
function taskDiagnostic(error: any, message: string, nodeId: string | undefined, credentials: InvocationContext['credentials']): Diagnostic {
  const payload = error.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : {}
  return { code: error.code ?? 'WORKER_ERROR', message, ...(nodeId ? { nodeId } : {}),
    ...Object.fromEntries(['field', 'stage', 'action'].filter(key => typeof payload[key] === 'string').map(key => [key, redact(payload[key], credentials)])),
    ...(typeof error.status === 'number' ? { status: error.status } : {}),
    ...(error.details !== undefined ? { details: safeDetails(error.details, credentials) } : {}),
  }
}
function acceptsIntegrity(current: { integrity: string; compatibleIntegrities?: string[] }, pinned: string) {
  return current.integrity === pinned || current.compatibleIntegrities?.includes(pinned) === true
}
function ref(value: any): value is ArtifactRef { return value && typeof value.id === 'string' && typeof value.schemaId === 'string' && Object.keys(value).length === 2 }
function fingerprint(value: any): string {
  const canonical = (item: any): any => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, canonical(item[key])])) : item
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
type Reuse = { source: TaskRecord; fromStep: string } | { source: TaskRecord; graph: RerunTask }

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
    const { artifacts, credentialRefs, rawSnapshot, actionReceipts, ...publicTask } = task
    const cover = taskCover(task)
    const mayStillRun = Object.values(task.externalRequests ?? {}).some(value => value.mayStillRun)
    const allowedActions = terminal.has(task.status) ? ['rerun', 'delete'] : ['cancel']
    if (!task.legacy && ['failed', 'cancelled'].includes(task.status) && !mayStillRun) allowedActions.unshift('retry')
    if (task.graphSnapshot && !terminal.has(task.status) && task.status !== 'cancelling' && task.steps.some(step => step.status === 'awaiting_review')) allowedActions.unshift('approve', 'correct')
    const types = task.graphSnapshot ? nodeTypes(this.ctx.catalog) : []
    return {
      ...publicTask, mayStillRun, allowedActions,
      steps: task.steps.map(step => {
        const node = task.graphSnapshot?.nodes.find(node => node.id === step.id)
        const type = node && types.find(type => type.type === node.type && type.version === node.typeVersion && type.providerId === node.provider.id)
        return { ...step, label: node?.label ?? type?.label ?? step.label }
      }),
      ...(cover ? { cover: { artifactId: cover.id } } : {}),
      outputs: (task.outputs ?? []).map(output => {
        const file = artifacts?.[output.artifact.id]
        if (!file) throw new AppError('OUTPUT_MISSING', `Output artifact missing: ${output.artifact.id}`, 500)
        return { id: output.id, label: output.label, role: output.role, name: file.name, mimeType: file.mimeType, size: file.size }
      }),
    }
  }
  private summary(task: TaskRecord): TaskSummary {
    const value = this.view(task)
    const { id, revision, attempt, status, sourceName, workflowId, workflowVersion, workflowSource, error, message, createdAt, updatedAt, queuedAt, startedAt, finishedAt, nextPollAt, legacy, cover, outputs, allowedActions, mayStillRun } = value
    return { id, revision, attempt, status, sourceName, workflowId, workflowVersion, workflowSource: workflowSource ?? (task.graphSnapshot ? { documentId: task.graphSnapshot.id, documentRevision: null, title: task.graphSnapshot.title } : undefined), error, message, createdAt, updatedAt, queuedAt, startedAt, finishedAt, nextPollAt, legacy, cover, outputs, allowedActions, mayStillRun,
      steps: value.steps.map(({ id, label, status, progress, message, startedAt, finishedAt, error }) => ({ id, label, status, progress, message, startedAt, finishedAt, error })),
    }
  }
  async get(id: string) { return this.view(await this.record(id)) }
  async list(query: TaskQuery = {}) {
    const page = await this.ctx.store.call('store.list', { limit: query.limit ?? 30, offset: query.offset ?? 0, ...query })
    return { ...page, items: page.items.map((task: TaskRecord) => this.summary(task)) }
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
    if (['version', 'pluginId', 'pluginVersion'].some(key => workflow[key as keyof typeof workflow] !== plan.workflow[key as keyof typeof plan.workflow]) || !acceptsIntegrity(workflow, plan.workflow.integrity)) throw new AppError('WORKFLOW_VERSION_UNAVAILABLE', 'Pinned workflow is unavailable.', 409)
    if (!plan.steps.length) throw new AppError('INVALID_PLAN', 'Workflow plan has no steps.', 422)
    for (const step of plan.steps) {
      if (!step.id || ids.has(step.id)) throw new AppError('INVALID_PLAN', 'Step IDs must be unique.', 422)
      const binding = plan.bindings[step.bindingKey]
      if (!binding) throw new AppError('INVALID_PLAN', `Missing binding ${step.bindingKey}`, 422)
      const provider = this.ctx.catalog.provider(binding.providerId).describe()
      if (provider.pluginId !== binding.pluginId || provider.pluginVersion !== binding.pluginVersion || !acceptsIntegrity(provider, binding.integrity)) throw new AppError('PLUGIN_VERSION_UNAVAILABLE', `Pinned provider ${binding.providerId} is unavailable.`, 409)
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
  async create(request: CreateTask) { return this.createWithReuse(request) }
  private async createWithReuse(request: CreateTask, reuse?: Reuse) {
    this.assertReady(); requireId(request.id)
    return this.ctx.settings.locked(async () => {
      const workflow = this.ctx.catalog.workflow(request.workflowId)
      if (request.workflowVersion && request.workflowVersion !== workflow.version) throw new AppError('WORKFLOW_VERSION_UNAVAILABLE', 'Selected workflow version is unavailable.', 409)
      const description = workflow.describe()
      validate(description.configSchema, request.config, 'Workflow configuration')
      if (!('graph' in workflow) && (request.graphDocument !== undefined || request.nodeRuntimeInputs !== undefined)) throw new AppError('INVALID_CONFIG', 'This workflow does not accept a graph document.', 422)
      if ('graph' in workflow && request.graphDocument === undefined) throw new AppError('GRAPH_REQUIRED', 'A graph document is required.', 422)
      const document = request.graphDocument === undefined ? undefined : parseWorkflowDocument(request.graphDocument)
      const runtimeInputs = request.nodeRuntimeInputs === undefined ? {} : request.nodeRuntimeInputs
      const slots = document?.inputs.map(slot => ({ ...slot, name: slot.id })) ?? description.inputs
      const artifacts = request.artifacts ?? {}
      for (const slot of slots) {
        const input = request.inputs[slot.name], artifact = input && artifacts[input.id]
        if (!input && !slot.required) continue
        if (!artifact || artifact.invocationId !== 'input') throw new AppError('INPUT_MISSING', `Input ${slot.name} is required.`, 422)
        await this.ctx.files.resolve(request.id, artifact)
      }
      if (Object.keys(request.inputs).some(key => !slots.some(slot => slot.name === key))) throw new AppError('INVALID_CONFIG', 'Unknown workflow input slot.', 422)
      let plan: WorkflowPlan, graphSnapshot: WorkflowDocument | undefined
      if ('graph' in workflow) {
        ({ plan, graphSnapshot } = await workflow.graph.compile({ document: document!, inputs: request.inputs, nodeRuntimeInputs: runtimeInputs }, this.ctx.catalog))
      } else {
        const diagnostics = await workflow.validate(request.inputs, request.config, this.ctx.catalog)
        if (diagnostics.length) throw new AppError(diagnostics[0].code, diagnostics[0].message, 422, diagnostics)
        plan = await workflow.plan(request.inputs, request.config, this.ctx.catalog)
      }
      this.checkPlan(plan)
      const reusedSteps = reuse ? 'graph' in reuse
        ? await this.reuseGraph(request.id, plan, graphSnapshot!, reuse.source, reuse.graph, artifacts)
        : await this.reusePrefix(request.id, plan, reuse.source, reuse.fromStep, artifacts) : []
      const snapshot = await this.ctx.settings.snapshot()
      const remote = new Set(Object.values(plan.bindings).map(binding => this.ctx.catalog.provider(binding.providerId).describe()).filter(provider => provider.execution === 'remote').map(provider => provider.adapter ?? provider.id))
      const connections = snapshot.connections.filter(connection => remote.has(connection.adapter))
      const credentialRefs = Object.fromEntries(Object.entries(snapshot.credentialRefs).filter(([adapter]) => remote.has(adapter)))
      const timestamp = now()
      const task: TaskRecord = {
        id: request.id, revision: 0, attempt: 1, status: 'queued', sourceName: request.sourceName ?? Object.values(artifacts)[0]?.name ?? description.label,
        workflowId: workflow.id, workflowVersion: workflow.version, config: plan.config, plan, inputs: request.inputs, artifacts,
        steps: plan.steps.map(step => reusedSteps.find(reused => reused.id === step.id) ?? ({ id: step.id, label: step.label, status: 'pending', invocationId: null, progress: null, message: null, startedAt: null, finishedAt: null, outputs: {}, error: null })),
        outputs: [], connections, credentialRefs, externalRequests: {}, error: null, message: null,
        createdAt: timestamp, updatedAt: timestamp, queuedAt: timestamp, startedAt: null, finishedAt: null, nextPollAt: null,
        ...(graphSnapshot ? { graphSnapshot, nodeRuntimeInputs: structuredClone(runtimeInputs), workflowSource: { documentId: graphSnapshot.id, documentRevision: request.documentRevision ?? null, title: graphSnapshot.title } } : {}),
        ...(reuse ? { reusedFrom: { taskId: reuse.source.id, attempt: reuse.source.attempt, fromStep: 'fromStep' in reuse ? reuse.fromStep : '', workflow: structuredClone(reuse.source.plan.workflow), bindings: structuredClone(reuse.source.plan.bindings) } } : {}),
      }
      await this.ctx.settings.credentials(task)
      if (graphSnapshot) await this.advance(task)
      return this.view(await this.ctx.store.call('store.create', { task }))
    })
  }
  private async reusePrefix(id: string, plan: WorkflowPlan, source: TaskRecord, fromStep: string, artifacts: TaskRecord['artifacts']) {
    const index = plan.steps.findIndex(step => step.id === fromStep)
    if (index < 0) throw new AppError('REUSE_NOT_ALLOWED', `Workflow has no step ${fromStep}.`, 422)
    const prefix = plan.steps.slice(0, index)
    if (!isDeepStrictEqual(prefix, source.plan.steps.slice(0, index))) throw new AppError('REUSE_NOT_ALLOWED', 'Earlier workflow steps changed; their outputs cannot be reused.', 409)
    const references = new Map<string, ArtifactRef>()
    const collect = (value: any): void => {
      if (ref(value)) {
        const artifact = source.artifacts[value.id]
        if (!artifact || artifact.schemaId !== value.schemaId) throw new AppError('REUSE_OUTPUT_INVALID', 'Reused artifact does not match its registration.', 409)
        references.set(value.id, value)
      } else if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    const steps = prefix.map(spec => {
      const step = source.steps.find(item => item.id === spec.id)
      if (!step || step.status !== 'completed') throw new AppError('REUSE_NOT_ALLOWED', `Earlier step ${spec.id} has not completed.`, 409)
      for (const port of spec.outputs) {
        const output = step.outputs[port.name]
        if (output === undefined) {
          if (port.required) throw new AppError('REUSE_OUTPUT_INVALID', `Missing ${spec.id}.${port.name}.`, 409)
          continue
        }
        if (port.kind === 'artifact' && (!ref(output) || output.schemaId !== port.schemaId)) throw new AppError('REUSE_OUTPUT_INVALID', `Invalid ${spec.id}.${port.name}.`, 409)
        if (port.kind === 'json') validate(port.schema!, output, `${spec.id}.${port.name}`, 'REUSE_OUTPUT_INVALID')
      }
      collect(step.outputs)
      return structuredClone(step)
    })
    const copied = await this.ctx.files.copyArtifacts(source, id, [...references.values()])
    for (const artifact of Object.values(copied)) artifacts[artifact.id] = artifact
    const replace = (value: any): any => {
      if (ref(value)) return { id: copied[value.id]!.id, schemaId: value.schemaId }
      if (Array.isArray(value)) return value.map(replace)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
      return value
    }
    return steps.map(step => ({ ...step, outputs: replace(step.outputs) }))
  }
  private inputs(task: TaskRecord, spec: StepSpec, allowMissing = false): JsonObject {
    const inputs: JsonObject = {}
    for (const [key, value] of Object.entries(spec.input)) {
      const upstream = value?.from === 'step' ? task.steps.find(step => step.id === value.stepId) : undefined
      if (upstream && task.graphSnapshot && (upstream.status !== 'completed' || upstream.approvedRevision !== upstream.outputRevision)) {
        if (allowMissing) continue
        throw new AppError('RESULT_NOT_APPROVED', `Input ${spec.id}.${key} is waiting for approval.`, 409)
      }
      const input = value?.from === 'task' ? task.inputs[value.name] : value?.from === 'step' ? upstream?.outputs[value.output] : value
      if (input === undefined) {
        if (allowMissing) continue
        throw new AppError('INPUT_MISSING', `Input ${spec.id}.${key} is missing.`, 422)
      }
      inputs[key] = input
    }
    return inputs
  }
  private validateOutputSemantics(spec: StepSpec, outputs: JsonObject, inputs: JsonObject, code = 'INVALID_PROVIDER_RESULT') {
    for (const port of spec.outputs) if (port.kind === 'json' && outputs[port.name] !== undefined) {
      try { this.ctx.catalog.validateOutput(port.schemaId, outputs[port.name], { inputs, outputs }) }
      catch (error) {
        if (!(error instanceof AppError)) throw error
        throw new AppError(code, `${spec.id}.${port.name}: ${error.message}`, code === 'INVALID_CORRECTION' ? 422 : 500, { field: port.name, nodeId: spec.id, details: error.details })
      }
    }
  }
  private async verifyOutputs(task: TaskRecord, spec: StepSpec, outputs: JsonObject, code = 'INVALID_CORRECTION') {
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) throw new AppError(code, 'Node outputs must be an object.', 422)
    if (Object.keys(outputs).some(name => !spec.outputs.some(port => port.name === name))) throw new AppError(code, 'Node returned an undeclared output port.', 422)
    for (const port of spec.outputs) {
      const output = outputs[port.name]
      if (output === undefined) {
        if (port.required) throw new AppError(code, `Missing ${spec.id}.${port.name}.`, 422)
        continue
      }
      if (port.kind === 'artifact' && (!ref(output) || output.schemaId !== port.schemaId)) throw new AppError(code, `Invalid ${spec.id}.${port.name}.`, 422)
      if (port.kind === 'json' && !validator.validate(port.schema!, output)) throw new AppError(code, `${spec.id}.${port.name}: ${validator.errorsText()}`, 422)
    }
    this.validateOutputSemantics(spec, outputs, this.inputs(task, spec), code)
    const verify = async (value: any): Promise<void> => {
      if (ref(value)) {
        const artifact = task.artifacts[value.id]
        if (!artifact || artifact.schemaId !== value.schemaId) throw new AppError(code, 'Artifact does not belong to this task.', 422)
        await this.ctx.files.resolve(task.id, artifact)
      } else if (Array.isArray(value)) { for (const item of value) await verify(item) }
      else if (value && typeof value === 'object') { for (const item of Object.values(value)) await verify(item) }
    }
    await verify(outputs)
  }
  private async correction(task: TaskRecord, spec: StepSpec, baselineOutputs: JsonObject, patch: JsonObject) {
    const provider = this.ctx.catalog.provider(task.plan.bindings[spec.bindingKey].providerId)
    const declaration = provider.describe().operations.find(operation => operation.id === spec.operation)?.node?.corrections
    if (!declaration || !provider.validateCorrection) throw new AppError('CORRECTION_UNSUPPORTED', 'This node does not support corrections.', 422)
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw new AppError('INVALID_CORRECTION', 'A correction must include an editable output port.', 422)
    for (const name of Object.keys(patch)) {
      const port = spec.outputs.find(port => port.name === name)
      if (!port || !declaration.outputPorts.includes(name) || !declaration.schemaIds.includes(port.schemaId)) throw new AppError('CORRECTION_READ_ONLY', `Output ${name} cannot be edited.`, 422)
    }
    await this.verifyOutputs(task, spec, { ...baselineOutputs, ...patch })
    const outputs = await provider.validateCorrection({ operation: spec.operation, inputs: structuredClone(this.inputs(task, spec)), baselineOutputs: structuredClone(baselineOutputs), patch: structuredClone(patch) })
    await this.verifyOutputs(task, spec, outputs)
    for (const port of spec.outputs) if (!(port.name in patch) && !isDeepStrictEqual(outputs[port.name], baselineOutputs[port.name])) throw new AppError('CORRECTION_READ_ONLY', `Correction changed unedited output ${port.name}.`, 422)
    return outputs
  }
  private inputsApproved(task: TaskRecord, spec: StepSpec, checked = new Map<string, boolean>()): boolean {
    const cached = checked.get(spec.id)
    if (cached !== undefined) return cached
    const approved = Object.values(spec.input).every(input => {
      if (input?.from !== 'step') return true
      const upstream = task.steps.find(step => step.id === input.stepId)
      const upstreamSpec = task.plan.steps.find(step => step.id === input.stepId)
      // Reused results still depend on approval of every upstream review gate.
      return upstream?.status === 'completed' && upstream.approvedRevision === upstream.outputRevision
        && !!upstreamSpec && this.inputsApproved(task, upstreamSpec, checked)
    })
    checked.set(spec.id, approved)
    return approved
  }
  /** A review blocks only its dependent nodes; other ready branches can advance. */
  private async advance(task: TaskRecord, preserveExecution = false) {
    if (task.graphSnapshot) {
      for (const spec of task.plan.steps) {
        const step = task.steps.find(step => step.id === spec.id)!
        if (step.status === 'completed' && step.approvedRevision === step.outputRevision) continue
        if (!this.inputsApproved(task, spec)) {
          if (step.outputRevision && step.approvedRevision !== step.outputRevision) step.status = 'pending'
          continue
        }
        if (step.outputRevision && step.resultRevisions?.some(result => result.revision === step.outputRevision)) {
          if (spec.autoContinue === false && step.approvedRevision !== step.outputRevision) step.status = 'awaiting_review'
          else { step.status = 'completed'; step.approvedRevision = step.outputRevision }
        }
      }
      // A review may arrive while an unrelated invocation owns the execution slot,
      // including the gap between claiming the task and marking its node running.
      if (preserveExecution && task.status === 'running') return
      if (task.steps.some(step => step.status === 'waiting')) { task.status = 'waiting'; return }
      const ready = task.plan.steps.some(spec => {
        const step = task.steps.find(step => step.id === spec.id)!
        return step.status === 'pending' && !step.outputRevision && this.inputsApproved(task, spec)
      })
      task.nextPollAt = null
      if (ready) {
        task.status = 'queued'; task.finishedAt = null; task.message = null; task.queuedAt = now()
        return
      }
      if (task.steps.some(step => step.status === 'awaiting_review')) {
        task.status = 'paused'; task.finishedAt = null; task.message = null
        return
      }
      if (task.steps.some(step => step.status !== 'completed' || step.approvedRevision !== step.outputRevision)) throw new AppError('INVALID_PLAN', 'No runnable node or review can unblock this workflow.', 500)
    } else {
      task.nextPollAt = null
      const pending = task.steps.find(step => step.status !== 'completed')
      if (pending) {
        if (pending.status !== 'pending') throw new AppError('INVALID_PLAN', `Node ${pending.id} cannot be scheduled from ${pending.status}.`, 500)
        task.status = 'queued'; task.finishedAt = null; task.message = null; task.queuedAt = now()
        return
      }
    }
    task.outputs = []
    for (const output of task.plan.outputs) {
      const artifact = task.steps.find(step => step.id === output.source.stepId)!.outputs[output.source.output]
      if (!artifact) { if (output.required) throw new AppError('STAGE_OUTPUT_MISSING', `Missing final output ${output.id}.`, 500); continue }
      if (!ref(artifact) || task.artifacts[artifact.id]?.schemaId !== artifact.schemaId) throw new AppError('INVALID_PROVIDER_RESULT', 'Final output is not a registered artifact.', 500)
      await this.ctx.files.resolve(task.id, task.artifacts[artifact.id])
      task.outputs.push({ id: output.id, label: output.label, role: output.role, artifact })
    }
    task.status = 'succeeded'; task.finishedAt = now(); task.message = 'Completed.'
  }
  async node(id: string, nodeId: string, revision?: number) {
    const task = await this.record(id), step = task.steps.find(step => step.id === nodeId), spec = task.plan.steps.find(spec => spec.id === nodeId)
    if (!step || !spec) throw new AppError('NODE_NOT_FOUND', 'Task node not found.', 404)
    const result = revision === undefined ? undefined : step.resultRevisions?.find(result => result.revision === revision)
    if (revision !== undefined && !result) throw new AppError('RESULT_NOT_FOUND', 'Node result revision not found.', 404)
    return {
      taskId: id, nodeId, taskRevision: task.revision, attempt: task.attempt, status: task.status,
      step: result ? { ...step, outputs: result.outputs, outputRevision: result.revision } : step,
      spec, inputs: this.inputs(task, spec, true), resultRevisions: step.resultRevisions ?? [],
      outputRevision: result?.revision ?? step.outputRevision ?? 0, approvedRevision: step.approvedRevision ?? null,
    }
  }
  async action(id: string, actionId: string): Promise<NodeActionReceipt | null> {
    requireId(actionId)
    return (await this.record(id)).actionReceipts?.[actionId]?.receipt ?? null
  }
  async approve(id: string, nodeId: string, request: ReviewCommand) { return this.review(id, nodeId, request, 'approve') }
  async correct(id: string, nodeId: string, request: ReviewCommand & { patch: JsonObject; continue?: boolean }) { return this.review(id, nodeId, request, 'correct') }
  private async review(id: string, nodeId: string, request: ReviewCommand & { patch?: JsonObject; continue?: boolean }, kind: 'approve' | 'correct'): Promise<NodeActionReceipt> {
    this.assertReady(); requireId(request.actionId)
    if (request.continue !== undefined && typeof request.continue !== 'boolean') throw new AppError('INVALID_CONFIG', 'continue must be a boolean.', 422)
    const release = this.ctx.files.readLock(id)
    try {
      return await this.locked(async () => {
        const task = await this.record(id), digest = fingerprint({ kind, nodeId, request })
        const existing = task.actionReceipts?.[request.actionId]
        if (existing) {
          if (existing.digest !== digest) throw new AppError('ACTION_CONFLICT', 'This action ID was already used for different content.', 409)
          return existing.receipt
        }
        this.expected(task, request.expectedAttempt)
        const step = task.steps.find(step => step.id === nodeId), spec = task.plan.steps.find(spec => spec.id === nodeId)
        if (!task.graphSnapshot || !['queued', 'running', 'waiting', 'paused'].includes(task.status) || step?.status !== 'awaiting_review' || !spec) throw new AppError('REVIEW_NOT_ALLOWED', 'This node is not awaiting review.', 409)
        if (step.outputRevision !== request.expectedOutputRevision) throw new AppError('OUTPUT_REVISION_CONFLICT', 'Node result changed. Keep your draft and reload the current result.', 409)
        this.checkPlan(task.plan)
        if (kind === 'correct') {
          const outputs = await this.correction(task, spec, step.outputs, request.patch!)
          const revision = (step.resultRevisions?.at(-1)?.revision ?? 0) + 1
          step.resultRevisions = [...step.resultRevisions ?? [], { revision, parentRevision: step.outputRevision!, source: 'correction', actionId: request.actionId, outputs, createdAt: now() }]
          step.outputs = outputs; step.outputRevision = revision; step.approvedRevision = null
          // A derived task can already hold reused downstream results when this gate pauses.
          // Invalidate their current projections together with the correction, retaining history.
          const invalidated = new Set([nodeId])
          for (const dependent of task.plan.steps) {
            if (!Object.values(dependent.input).some(input => input?.from === 'step' && invalidated.has(input.stepId))) continue
            invalidated.add(dependent.id)
            Object.assign(task.steps.find(step => step.id === dependent.id)!, {
              status: 'pending', invocationId: null, progress: null, message: null, startedAt: null, finishedAt: null,
              outputs: {}, error: null, operation: undefined, outputRevision: 0, approvedRevision: null, approvalActionId: null,
            })
          }
          task.outputs = []
        }
        if (kind === 'approve' || request.continue) {
          await this.verifyOutputs(task, spec, step.outputs)
          step.status = 'completed'; step.approvedRevision = step.outputRevision; step.approvalActionId = request.actionId
        }
        await this.advance(task, true)
        const receipt: NodeActionReceipt = { actionId: request.actionId, kind, nodeId, attempt: task.attempt, taskRevision: task.revision + 1, outputRevision: step.outputRevision!, status: task.status, createdAt: now() }
        task.actionReceipts = { ...task.actionReceipts, [request.actionId]: { digest, receipt } }
        await this.save(task)
        return receipt
      })
    } finally { release() }
  }
  private async graphReuse(source: TaskRecord, plan: WorkflowPlan, graph: WorkflowDocument, request: RerunTask) {
    if (!source.graphSnapshot) throw new AppError('GRAPH_REQUIRED', 'Only graph tasks support dependency reuse.', 422)
    const dirty = new Set<string>(), reasons: Record<string, string> = {}, corrections: Record<string, JsonObject> = {}
    const sourceRevisions: Record<string, number> = {}
    const identity = (taskPlan: WorkflowPlan, spec: StepSpec) => {
      const binding = taskPlan.bindings[spec.bindingKey], provider = this.ctx.catalog.provider(binding.providerId).describe()
      return { operation: spec.operation, input: spec.input, outputs: spec.outputs.map(({ label, ...port }) => port),
        binding: { ...binding, integrity: acceptsIntegrity(provider, binding.integrity) ? provider.integrity : binding.integrity },
      }
    }
    for (const spec of plan.steps) {
      const originalSpec = source.plan.steps.find(step => step.id === spec.id)
      const originalNode = source.graphSnapshot.nodes.find(node => node.id === spec.id), node = graph.nodes.find(node => node.id === spec.id)
      const original = source.steps.find(step => step.id === spec.id)
      const changed = !originalSpec || !originalNode || !node || originalNode.type !== node.type || originalNode.typeVersion !== node.typeVersion || !isDeepStrictEqual(identity(plan, spec), identity(source.plan, originalSpec))
      if (changed) { dirty.add(spec.id); reasons[spec.id] = 'node_changed' }
      else if (!original?.outputRevision || !original.resultRevisions?.some(result => result.revision === original.outputRevision)) { dirty.add(spec.id); reasons[spec.id] = 'result_missing' }
      else if (original.approvedRevision !== original.outputRevision) { dirty.add(spec.id); reasons[spec.id] = 'result_not_approved' }
      else sourceRevisions[spec.id] = original.outputRevision
    }
    for (const [nodeId, correction] of Object.entries(request.corrections ?? {})) {
      const spec = plan.steps.find(step => step.id === nodeId), original = source.steps.find(step => step.id === nodeId)
      const baseline = original?.resultRevisions?.find(result => result.revision === correction.revision)
      if (!spec || !baseline || correction.revision !== original?.outputRevision) throw new AppError('OUTPUT_REVISION_CONFLICT', `Source result ${nodeId} changed or is missing.`, 409)
      if (reasons[nodeId] === 'node_changed') throw new AppError('REUSE_NOT_ALLOWED', `Node ${nodeId} changed; its old result cannot be substituted.`, 409)
      corrections[nodeId] = await this.correction(source, spec, baseline.outputs, correction.patch)
      sourceRevisions[nodeId] = correction.revision
      dirty.delete(nodeId); delete reasons[nodeId]
    }
    for (const spec of plan.steps) {
      const affected = Object.values(spec.input).some(input => input?.from === 'step' && (dirty.has(input.stepId) || Object.hasOwn(corrections, input.stepId)))
      if (affected) {
        if (Object.hasOwn(corrections, spec.id)) throw new AppError('REUSE_NOT_ALLOWED', `Correction ${spec.id} depends on an upstream result that will change.`, 409)
        dirty.add(spec.id); reasons[spec.id] = 'upstream_changed'; delete sourceRevisions[spec.id]
      }
    }
    const reusedSteps = plan.steps.filter(spec => !dirty.has(spec.id) && !Object.hasOwn(corrections, spec.id)).map(spec => spec.id)
    const correctedSteps = Object.keys(corrections), dirtySteps = plan.steps.filter(spec => dirty.has(spec.id)).map(spec => spec.id)
    return { reusedSteps, correctedSteps, dirtySteps, reasons, sourceRevisions, corrections }
  }
  async rerunPreview(id: string, request: RerunTask) {
    const source = await this.record(id)
    if (!source.graphSnapshot) throw new AppError('GRAPH_REQUIRED', 'Dependency preview requires a graph task.', 422)
    if (request.expectedAttempt !== undefined) this.expected(source, request.expectedAttempt)
    if (request.expectedTaskRevision !== undefined && source.revision !== request.expectedTaskRevision) throw new AppError('REVISION_CONFLICT', 'Source task changed. Reload before previewing.', 409)
    const workflow = this.ctx.catalog.workflow(source.workflowId)
    if (!('graph' in workflow)) throw new AppError('GRAPH_REQUIRED', 'The original graph compiler is unavailable.', 409)
    const { plan, graphSnapshot } = await workflow.graph.compile({ document: request.graphDocument === undefined ? source.graphSnapshot : request.graphDocument, inputs: source.inputs, nodeRuntimeInputs: request.nodeRuntimeInputs === undefined ? source.nodeRuntimeInputs ?? {} : request.nodeRuntimeInputs }, this.ctx.catalog)
    this.checkPlan(plan)
    const release = this.ctx.files.readLock(id)
    try {
      const { corrections, ...preview } = await this.graphReuse(source, plan, graphSnapshot, request)
      for (const nodeId of [...preview.reusedSteps, ...preview.correctedSteps]) {
        const step = source.steps.find(step => step.id === nodeId)!
        await this.verifyOutputs(source, source.plan.steps.find(spec => spec.id === nodeId)!, Object.hasOwn(corrections, nodeId) ? corrections[nodeId] : step.outputs, 'REUSE_OUTPUT_INVALID')
      }
      return { ...preview, expectedAttempt: source.attempt, expectedTaskRevision: source.revision }
    } finally { release() }
  }
  private async reuseGraph(id: string, plan: WorkflowPlan, graph: WorkflowDocument, source: TaskRecord, request: RerunTask, artifacts: TaskRecord['artifacts']): Promise<StepState[]> {
    const reuse = await this.graphReuse(source, plan, graph, request)
    if (!request.sourceRevisions || !isDeepStrictEqual(request.sourceRevisions, reuse.sourceRevisions)) throw new AppError('OUTPUT_REVISION_CONFLICT', 'Source result revisions differ from the reuse preview.', 409)
    const references = new Map<string, ArtifactRef>()
    const collect = (value: any): void => {
      if (ref(value)) {
        if (source.artifacts[value.id]?.schemaId !== value.schemaId) throw new AppError('REUSE_OUTPUT_INVALID', 'Reused artifact does not match the source registration.', 409)
        references.set(value.id, value)
      } else if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') Object.values(value).forEach(collect)
    }
    const selected = new Set([...reuse.reusedSteps, ...reuse.correctedSteps])
    const steps: StepState[] = []
    for (const spec of plan.steps) {
      if (!selected.has(spec.id)) continue
      const step = structuredClone(source.steps.find(step => step.id === spec.id)!)
      const corrected = Object.hasOwn(reuse.corrections, spec.id)
      if (corrected) {
        const revision = step.resultRevisions!.at(-1)!.revision + 1
        step.resultRevisions!.push({ revision, parentRevision: step.outputRevision!, source: 'correction', actionId: id, outputs: reuse.corrections[spec.id], createdAt: now() })
        step.outputRevision = revision; step.outputs = reuse.corrections[spec.id]
      }
      await this.verifyOutputs(source, spec, step.outputs, 'REUSE_OUTPUT_INVALID')
      collect(step.outputs); collect(step.resultRevisions)
      step.label = spec.label; step.status = 'completed'; step.error = null; step.operation = undefined
      step.approvedRevision = corrected || spec.autoContinue !== false ? step.outputRevision : null
      step.approvalActionId = corrected ? id : null
      steps.push(step)
    }
    const copied = await this.ctx.files.copyArtifacts(source, id, [...references.values()])
    for (const artifact of Object.values(copied)) artifacts[artifact.id] = artifact
    const replace = (value: any): any => {
      if (ref(value)) return { id: copied[value.id]!.id, schemaId: value.schemaId }
      if (Array.isArray(value)) return value.map(replace)
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]))
      return value
    }
    return steps.map(step => ({ ...step, outputs: replace(step.outputs), resultRevisions: replace(step.resultRevisions) }))
  }
  private expected(task: TaskRecord, attempt: number) { if (task.attempt !== attempt) throw new AppError('ATTEMPT_CONFLICT', 'Task attempt changed. Refresh before acting.', 409) }
  async cancel(id: string, expectedAttempt: number, expectedTaskRevision?: number) {
    this.assertReady()
    const task = await this.change(id, task => {
      this.expected(task, expectedAttempt)
      if (task.graphSnapshot && expectedTaskRevision !== task.revision) throw new AppError('REVISION_CONFLICT', 'Task changed. Reload before cancelling.', 409)
      if (terminal.has(task.status)) throw new AppError('TASK_BUSY', 'Task has already stopped.', 409)
      if (['queued', 'paused'].includes(task.status) && this.active?.id !== id) {
        task.status = 'cancelled'; task.finishedAt = now(); task.nextPollAt = null
        for (const step of task.steps) if (['pending', 'awaiting_review'].includes(step.status)) { step.status = 'cancelled'; step.finishedAt = task.finishedAt }
      }
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
        task.steps = task.steps.map(step => ({ ...step, status: 'pending', invocationId: null, progress: null, message: null, startedAt: null, finishedAt: null, outputs: {}, error: null, operation: undefined, outputRevision: 0, approvedRevision: null, approvalActionId: null }))
      }))
    } finally { await release() }
  }
  async rerun(id: string, request: RerunTask) {
    this.assertReady()
    const source = await this.record(id)
    if (source.graphSnapshot) {
      this.expected(source, request.expectedAttempt!)
      if (source.revision !== request.expectedTaskRevision) throw new AppError('REVISION_CONFLICT', 'Source task changed. Refresh the reuse preview.', 409)
      if (request.workflowId && request.workflowId !== source.workflowId) throw new AppError('REUSE_NOT_ALLOWED', 'A derived graph task must use the same graph compiler.', 422)
    }
    if (source.legacy && !request.workflowId) throw new AppError('WORKFLOW_REQUIRED', 'Select a current workflow to rerun a historical task.', 422)
    if (!terminal.has(source.status)) throw new AppError('TASK_BUSY', 'Stop the source task before rerunning.', 409)
    if (Object.values(source.externalRequests ?? {}).some(item => item.mayStillRun) && !request.acknowledgeExternalRisk) throw new AppError('EXTERNAL_RESULT_UNKNOWN', 'Acknowledge the previous remote request before rerunning.', 409)
    if (request.fromStep !== undefined && (typeof request.fromStep !== 'string' || !request.fromStep || source.legacy || (request.workflowId ?? source.workflowId) !== source.workflowId || !isDeepStrictEqual(request.config, source.config))) throw new AppError('REUSE_NOT_ALLOWED', 'Partial rerun requires the same workflow and configuration of a current task.', 409)
    const readRelease = this.ctx.files.readLock(id)
    let writeRelease: (() => void | Promise<void>) | undefined
    try {
      writeRelease = await this.ctx.files.reserve(request.id, true)
      const inputs = await this.ctx.files.copyInputs(source, request.id)
      if (source.graphSnapshot) {
        if (request.fromStep !== undefined) throw new AppError('REUSE_NOT_ALLOWED', 'Graph reruns use dependency reuse instead of a linear step boundary.', 422)
        const current = await this.record(id)
        if (current.revision !== source.revision) throw new AppError('REVISION_CONFLICT', 'Source task changed while creating the copy.', 409)
        return await this.createWithReuse({ id: request.id, workflowId: source.workflowId, config: request.config, sourceName: source.sourceName, graphDocument: request.graphDocument === undefined ? source.graphSnapshot : request.graphDocument, nodeRuntimeInputs: request.nodeRuntimeInputs === undefined ? source.nodeRuntimeInputs ?? {} : request.nodeRuntimeInputs, ...inputs }, { source, graph: request })
      }
      return await this.createWithReuse({ id: request.id, workflowId: request.workflowId ?? source.workflowId, config: request.config, sourceName: source.sourceName, ...inputs }, request.fromStep === undefined ? undefined : { source, fromStep: request.fromStep })
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
          for (const step of task.steps) if (['pending', 'running', 'waiting', 'awaiting_review'].includes(step.status)) { step.status = 'cancelled'; step.finishedAt = task.finishedAt }
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
      currentStep = initial.graphSnapshot
        ? initial.steps.find(step => step.status === 'waiting') ?? initial.steps.find(step => step.status === 'pending' && !step.outputRevision && this.inputsApproved(initial, initial.plan.steps.find(spec => spec.id === step.id)!))
        : initial.steps.find(step => step.status !== 'completed')
      if (initial.graphSnapshot && (!currentStep || currentStep.outputRevision)) {
        await this.change(initial.id, task => this.advance(task))
        return
      }
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
      const inputs = this.inputs(started, spec)
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
        log: message => this.ctx.files.log(initial.id, `[${spec.id}] ${redact(message, credentials)}`),
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
      if (Object.keys(result.outputs).some(name => !spec.outputs.some(port => port.name === name))) throw new AppError('INVALID_PROVIDER_RESULT', 'Provider returned an undeclared output port.', 500)
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
      this.validateOutputSemantics(spec, result.outputs, inputs)
      await verifyReferences(result.outputs)
      await this.ctx.files.log(initial.id, `[${spec.id}] completed`)
      await update(async (task, step) => {
        Object.assign(task.artifacts, invocationArtifacts)
        step.status = 'completed'; step.outputs = result.outputs; step.progress = 1; step.finishedAt = now(); task.nextPollAt = null
        if (task.graphSnapshot) {
          const revision = (step.resultRevisions?.at(-1)?.revision ?? 0) + 1
          step.resultRevisions = [...step.resultRevisions ?? [], { revision, parentRevision: null, source: 'computed', actionId: null, outputs: structuredClone(result.outputs), createdAt: now() }]
          step.outputRevision = revision; step.approvedRevision = spec.autoContinue === false ? null : revision
        }
        await this.advance(task)
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
        task.error = cancelled ? null : taskDiagnostic(error, message, currentStep?.id, credentials)
        for (const request of Object.values(task.externalRequests)) if (request.mayStillRun) request.state = 'unknown'
        const step = task.steps.find(step => step.id === currentStep?.id)
        if (step) { step.status = cancelled ? 'cancelled' : 'failed'; step.error = task.error; step.finishedAt = now() }
        if (cancelled) for (const pending of task.steps) if (['pending', 'awaiting_review'].includes(pending.status)) { pending.status = 'cancelled'; pending.finishedAt = task.finishedAt }
      })
      if (error.code === 'CANCEL_TIMEOUT') throw error
    } finally { this.active = undefined }
  }
}
