import { isDeepStrictEqual } from 'node:util'
import { AppError, type CatalogService, type Diagnostic, type JsonObject, type StoreService, type WorkflowDocument } from '@youdub/sdk'
import { inspectGraph } from './workflow-graph.js'

export const legacyDefaultsWorkflowId = 'user.legacy-defaults-v1'
const namespace = 'plugin:youdub.localize'
export type DefaultsMigration = { version: 1; status: 'complete'; documentId: string; revision: number } | { version: 1; status: 'blocked'; diagnostics: Diagnostic[] }
export async function readDefaultsMigration(store: StoreService): Promise<DefaultsMigration | null> {
  const raw = await store.call('settings.raw')
  return raw[namespace]?.defaultsMigration ?? null
}
const optionFields: Record<string, string[]> = {
  recognize: ['sourceLanguage', 'initialPrompt'], translate: ['sourceLanguage', 'targetLanguage'],
  synthesize: ['targetLanguage', 'voice'], mix: ['keepBackground'], align: ['targetLanguage'],
  export: ['sourceLanguage', 'targetLanguage', 'renderSubtitles'],
}

/** Reuse the legacy planner so its optional branches retain their original meaning. */
export async function legacyDefaultsDocument(defaults: JsonObject, catalog: CatalogService): Promise<WorkflowDocument> {
  const providers = catalog.listProviders()
  for (const capability of ['asr', 'translation', 'tts', 'separation', 'subtitle_alignment']) {
    const selection = defaults[capability]
    if (selection && !providers.some(provider => provider.capability === capability && (provider.adapter ?? provider.id) === selection.adapter)) {
      throw new AppError('DEFAULTS_MIGRATION_BLOCKED', `Provider ${selection.adapter} is unavailable.`, 422, [{ code: 'NODE_UNAVAILABLE', message: `Provider ${selection.adapter} is unavailable.`, field: `${capability}.adapter` }])
    }
  }
  const workflow = catalog.workflow('youdub.localize')
  if (!('plan' in workflow)) throw new AppError('DEFAULTS_MIGRATION_BLOCKED', 'The legacy workflow planner is unavailable.', 422)
  const plan = await workflow.plan({}, defaults, catalog)
  const document: WorkflowDocument = {
    format: 'youdub.workflow', formatVersion: 1, id: legacyDefaultsWorkflowId, title: '原默认处理配置', nodes: [], edges: [],
    inputs: workflow.describe().inputs.map(input => ({ id: input.name, label: input.label, required: true, kind: 'artifact', schemaId: 'file/v1', acceptedMimeTypes: [...input.acceptedMimeTypes] })),
    outputs: [], presentation: { positions: { $inputs: { x: 0, y: 120 } }, viewport: { x: 40, y: 40, zoom: 0.6 } },
  }
  for (const [index, step] of plan.steps.entries()) {
    const binding = plan.bindings[step.bindingKey]
    const operation = providers.find(provider => provider.id === binding.providerId)?.operations.find(operation => operation.id === step.operation)
    if (!operation?.node) throw new AppError('DEFAULTS_MIGRATION_BLOCKED', `Operation ${step.operation} has no workflow node.`, 422, [{ code: 'NODE_UNAVAILABLE', message: `Operation ${step.operation} has no workflow node.`, nodeId: step.id }])
    const node = operation.node
    const options: JsonObject = { ...binding.options, ...(step.id === 'export' ? { renderSubtitles: defaults.output_mode !== 'dubbing' } : {}) }
    const fields = optionFields[step.id] ?? []
    for (const field of fields) if (!(field in (node.configSchema.properties ?? {}))) throw new AppError('DEFAULTS_MIGRATION_BLOCKED', `Node ${step.id} cannot preserve ${field}.`, 422, [{ code: 'UNMAPPED_SETTING', message: `Node ${step.id} cannot preserve ${field}.`, nodeId: step.id, field }])
    const config = Object.fromEntries(fields.filter(key => options[key] !== undefined).map(key => [key, structuredClone(options[key])]))
    document.nodes.push({ id: step.id, type: node.type, typeVersion: node.version,
      provider: { id: binding.providerId, ...(binding.model ? { model: binding.model } : {}), ...(binding.device ? { device: binding.device } : {}) }, config, autoContinue: true })
    document.presentation.positions[step.id] = { x: (index + 1) * 320, y: 120 }
    for (const [portId, input] of Object.entries(step.input)) {
      if (input?.from !== 'task' && input?.from !== 'step') throw new AppError('DEFAULTS_MIGRATION_BLOCKED', `Input ${step.id}.${portId} cannot be stored in a workflow.`, 422)
      document.edges.push({ id: `${step.id}-${portId}`, source: input.from === 'task' ? { nodeId: '$inputs', portId: input.name } : { nodeId: input.stepId, portId: input.output }, target: { nodeId: step.id, portId } })
    }
  }
  document.outputs = plan.outputs.map(output => {
    const port = plan.steps.find(step => step.id === output.source.stepId)?.outputs.find(port => port.name === output.source.output)
    if (!port || port.kind !== 'artifact') throw new AppError('DEFAULTS_MIGRATION_BLOCKED', `Output ${output.id} cannot be stored in a workflow.`, 422)
    return { id: output.id, label: output.label, kind: 'artifact', schemaId: port.schemaId, required: output.required, source: { nodeId: output.source.stepId, portId: output.source.output } }
  })
  document.presentation.positions.$outputs = { x: (plan.steps.length + 1) * 320, y: 120 }
  const checked = inspectGraph(document, catalog, {}, false)
  if (checked.diagnostics.length) throw new AppError('DEFAULTS_MIGRATION_BLOCKED', 'Saved processing preferences need attention before import.', 422, checked.diagnostics)
  return checked.document
}

/** Caller serializes this operation with ordinary settings edits. Storage failures propagate. */
export async function migrateLegacyDefaults(store: StoreService, catalog: CatalogService): Promise<DefaultsMigration | null> {
  const raw = await store.call('settings.raw'), previous = raw[namespace]?.defaultsMigration
  if (previous?.version === 1 && previous.status === 'complete') return previous
  if (!raw.defaults || !Object.keys(raw.defaults).length) return null
  let document: WorkflowDocument
  try {
    const defaults = await store.call('settings.validate_defaults', { defaults: raw.defaults })
    document = await legacyDefaultsDocument(defaults, catalog)
    return await store.call('store.workflow_migrate_defaults', { document, expectedDefaults: raw.defaults })
  } catch (error) {
    if (!(error instanceof AppError) || !['INVALID_CONFIG', 'DEFAULTS_MIGRATION_BLOCKED', 'WORKFLOW_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'INVALID_WORKFLOW', 'WORKFLOW_DOCUMENT_EXISTS'].includes(error.code)) throw error
    const details = (Array.isArray(error.details) ? error.details : (error.details as JsonObject | undefined)?.details) as Array<Diagnostic & { loc?: (string | number)[]; msg?: string }> | undefined
    const diagnostics: Diagnostic[] = Array.isArray(details) ? details.map(item => ({ code: item.code ?? error.code, message: item.message ?? item.msg ?? error.message, ...(item.field ? { field: item.field } : item.loc ? { field: item.loc.join('.') } : {}), ...(item.nodeId ? { nodeId: item.nodeId } : {}), ...(item.portId ? { portId: item.portId } : {}), ...(item.edgeId ? { edgeId: item.edgeId } : {}) })) : [{ code: error.code, message: error.message }]
    const state: DefaultsMigration = { version: 1, status: 'blocked', diagnostics }
    if (!isDeepStrictEqual(previous, state)) await store.call('settings.write', { key: namespace, value: { ...raw[namespace], defaultsMigration: state } })
    return state
  }
}
