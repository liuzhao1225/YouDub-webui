import type { Context } from 'cordis'
import Ajv from 'ajv/dist/2020.js'
import { AppError, type ArtifactRef, type CatalogService, type Diagnostic, type GraphCompileRequest, type GraphWorkflowDefinition, type JsonObject, type NodeTypeDefinition, type WorkflowDocument, type WorkflowPlan } from '@youdub/sdk'
import { normalizeMediaRuntime, validateMediaNodeConfig, validateMediaGraph } from './media-graph-validation.js'
import { parseWorkflowDocument } from './workflow-document.js'

export const name = 'workflow-graph'
export const inject = ['catalog']
const ajv = new Ajv({ strict: false, allErrors: true })
const label = (value: NodeTypeDefinition['label']) => typeof value === 'string' ? value : value.translations?.zh ?? value.default
export function nodeTypes(catalog: CatalogService): NodeTypeDefinition[] {
  return catalog.listProviders().flatMap(provider => provider.operations.filter(operation => operation.node).map(operation => ({ ...structuredClone(operation.node!), providerId: provider.id, operation: operation.id, outputs: structuredClone(operation.outputs), provider })))
}
interface Inspection { document: WorkflowDocument; diagnostics: Diagnostic[]; order: string[]; types: Map<string, NodeTypeDefinition>; options: Map<string, JsonObject>; runtime: Record<string, JsonObject> }
export function inspectGraph(value: unknown, catalog: CatalogService, runtime: Record<string, JsonObject> = {}, ready = true): Inspection {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) throw new AppError('INVALID_RUNTIME_INPUT', 'Node runtime inputs must be an object.', 422)
  const inspectLiteral = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if ('from' in value && ['step', 'task'].includes(String(value.from)) || 'schemaId' in value && 'id' in value || '$artifact' in value || 'path' in value) throw new AppError('INVALID_RUNTIME_INPUT', 'Runtime values cannot contain file or task references.', 422)
    for (const [key, child] of Object.entries(value)) {
      if (/api[_-]?key|password|credential|authorization|secret|cookie/i.test(key)) throw new AppError('INVALID_RUNTIME_INPUT', 'Configure credentials in settings.', 422)
      inspectLiteral(child)
    }
  }
  for (const input of Object.values(runtime)) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('INVALID_RUNTIME_INPUT', 'Each node runtime input must be an object.', 422)
    inspectLiteral(input)
  }
  const document = parseWorkflowDocument(value), diagnostics: Diagnostic[] = [], types = new Map<string, NodeTypeDefinition>(), options = new Map<string, JsonObject>()
  const fail = (message: string, location: Partial<Diagnostic> = {}, code = 'INVALID_GRAPH') => diagnostics.push({ code, message, ...location })
  const definitions = nodeTypes(catalog), nodes = new Map(document.nodes.map(node => [node.id, node]))
  for (const key of Object.keys(runtime)) if (!nodes.has(key)) fail(`Unknown runtime input node: ${key}`, { nodeId: key })
  if (!document.nodes.length) fail('Add at least one node.')
  if (!document.outputs.length) fail('Select at least one output.')
  for (const node of document.nodes) {
    const type = definitions.find(type => type.type === node.type && type.providerId === node.provider.id)
    if (!type) { fail(`Node type or provider is unavailable: ${node.type} / ${node.provider.id}`, { nodeId: node.id }, 'NODE_UNAVAILABLE'); continue }
    types.set(node.id, type)
    if (type.version !== node.typeVersion) fail(`Node version ${node.typeVersion} is unavailable.`, { nodeId: node.id })
    const config = { ...type.defaults, ...(type.provider.defaults ?? {}), ...node.config }
    options.set(node.id, config)
    if (!ajv.validate(type.configSchema, config)) fail(ajv.errorsText(), { nodeId: node.id, field: 'config' })
    if (ready && !type.provider.available) fail(type.provider.unavailableReason || `Provider ${node.provider.id} is not ready.`, { nodeId: node.id }, 'PROVIDER_UNAVAILABLE')
    if (type.runtimeInputSchema) {
      if (!ajv.validate(type.runtimeInputSchema, runtime[node.id] ?? {})) fail(ajv.errorsText(), { nodeId: node.id, field: 'runtimeInput' })
      else runtime = normalizeMediaRuntime(node, type, runtime, fail)
    } else if (Object.keys(runtime[node.id] ?? {}).length) fail('This node has no runtime inputs.', { nodeId: node.id })
    const model = type.provider.models?.find(model => model.id === node.provider.model)
    // Resolve only the detached run snapshot. Reusable workflows keep "auto",
    // while the plan and task details record the exact supported device.
    if (ready && node.provider.device === 'auto') node.provider.device = model?.devices?.find((device: string) => device !== 'cpu') ?? model?.devices?.[0]
    if (type.provider.capability && (!node.provider.model || !node.provider.device)) fail('Select a model and device.', { nodeId: node.id, field: 'provider' })
    else if (ready && type.provider.models?.length && (!model || model.available === false || !model.devices?.includes(node.provider.device))) fail(model?.unavailableReason || 'Selected model or device is unavailable.', { nodeId: node.id, field: 'provider' })
    validateMediaNodeConfig(node, type, config, model, fail)
  }
  const sourcePort = (nodeId: string, portId: string) => nodeId === '$inputs' ? document.inputs.find(input => input.id === portId) : types.get(nodeId)?.outputs.find(output => output.name === portId)
  const targets = new Set<string>()
  for (const edge of document.edges) {
    const source = sourcePort(edge.source.nodeId, edge.source.portId), target = types.get(edge.target.nodeId)?.inputs.find(input => input.id === edge.target.portId)
    const location = { edgeId: edge.id, nodeId: edge.target.nodeId, portId: edge.target.portId }
    if (!source || !target) { fail('Connection references a missing port.', location); continue }
    if (source.kind !== target.kind || !target.acceptedSchemaIds.includes(source.schemaId)) fail('Incompatible port types.', location)
    const key = JSON.stringify([edge.target.nodeId, edge.target.portId])
    if (targets.has(key)) fail('An input accepts one connection.', location)
    targets.add(key)
  }
  const connected = (id: string, port: string) => targets.has(JSON.stringify([id, port]))
  for (const node of document.nodes) {
    const type = types.get(node.id)
    for (const port of type?.inputs ?? []) if (port.required && !connected(node.id, port.id)) fail(`Connect ${typeof port.label === 'string' ? port.label : port.id}.`, { nodeId: node.id, portId: port.id })
  }
  validateMediaGraph(document, types, options, connected, fail)
  for (const output of document.outputs) {
    const port = sourcePort(output.source.nodeId, output.source.portId)
    if (!port || output.source.nodeId === '$inputs' || port.kind !== 'artifact' || port.schemaId !== output.schemaId) fail('Final output must reference a matching artifact output.', { nodeId: output.source.nodeId, portId: output.source.portId })
  }
  const reachable = new Set<string>(), visit = (id: string) => { if (reachable.has(id) || id === '$inputs') return; reachable.add(id); document.edges.filter(edge => edge.target.nodeId === id).forEach(edge => visit(edge.source.nodeId)) }
  document.outputs.forEach(output => visit(output.source.nodeId))
  for (const node of document.nodes) if (!reachable.has(node.id)) fail('Connect this node to a final output.', { nodeId: node.id })
  for (const input of document.inputs) if (!document.edges.some(edge => edge.source.nodeId === '$inputs' && edge.source.portId === input.id)) fail('Remove or connect the unused workflow input.', { field: `inputs.${input.id}` })
  const order: string[] = [], remaining = new Set(document.nodes.map(node => node.id))
  while (remaining.size) {
    const next = document.nodes.find(node => remaining.has(node.id) && document.edges.filter(edge => edge.target.nodeId === node.id).every(edge => !remaining.has(edge.source.nodeId)))
    if (!next) { fail('Workflow contains a cycle.'); break }
    order.push(next.id); remaining.delete(next.id)
  }
  return { document, diagnostics, order, types, options, runtime }
}
export async function apply(ctx: Context, plugin: { integrity: string; compatibleIntegrities?: string[] }) {
  const workflow: GraphWorkflowDefinition = {
    id: 'youdub.graph', version: '1.0.0', pluginId: 'youdub.workflow-graph', pluginVersion: '1.0.0', integrity: plugin.integrity, compatibleIntegrities: plugin.compatibleIntegrities,
    describe: () => ({ id: workflow.id, version: workflow.version, label: '节点工作流', inputs: [], configSchema: { type: 'object', additionalProperties: false }, defaults: {}, ui: { editor: 'youdub.graph' } }),
    graph: { compile: async (request: GraphCompileRequest, catalog) => {
      const result = inspectGraph(request.document, catalog, request.nodeRuntimeInputs)
      const { document, diagnostics, order, types, options } = result
      for (const input of document.inputs) {
        const value: ArtifactRef | undefined = request.inputs[input.id]
        if (input.required && !value) diagnostics.push({ code: 'INPUT_REQUIRED', message: `Upload ${input.label}.`, field: input.id })
        if (value && value.schemaId !== input.schemaId) diagnostics.push({ code: 'INVALID_INPUT', message: `Input schema does not match ${input.id}.`, field: input.id })
      }
      for (const key of Object.keys(request.inputs)) if (!document.inputs.some(input => input.id === key)) diagnostics.push({ code: 'INVALID_INPUT', message: `Unknown input ${key}.`, field: key })
      if (diagnostics.length) throw new AppError('INVALID_GRAPH', 'Workflow validation failed.', 422, diagnostics)
      const plan: WorkflowPlan = { workflow: { id: workflow.id, version: workflow.version, pluginId: workflow.pluginId, pluginVersion: workflow.pluginVersion, integrity: workflow.integrity }, config: { graph: true }, bindings: {}, steps: [], outputs: [] }
      for (const id of order) {
        const node = document.nodes.find(node => node.id === id)!, type = types.get(id)!, provider = type.provider
        plan.bindings[id] = { pluginId: provider.pluginId, pluginVersion: provider.pluginVersion, integrity: provider.integrity, providerId: provider.id, ...node.provider.model && { model: node.provider.model }, ...node.provider.device && { device: node.provider.device }, modelRevision: provider.models?.find(model => model.id === node.provider.model)?.revision ?? null, options: structuredClone(options.get(id)!) }
        const input: JsonObject = { ...result.runtime[id] }
        for (const edge of document.edges.filter(edge => edge.target.nodeId === id)) input[edge.target.portId] = edge.source.nodeId === '$inputs' ? { from: 'task', name: edge.source.portId } : { from: 'step', stepId: edge.source.nodeId, output: edge.source.portId }
        plan.steps.push({ id, label: node.label ?? label(type.label), bindingKey: id, operation: type.operation, input, outputs: structuredClone(type.outputs), autoContinue: node.autoContinue })
      }
      plan.outputs = document.outputs.map(output => ({ id: output.id, label: output.label, source: { stepId: output.source.nodeId, output: output.source.portId }, role: output.id, required: output.required }))
      return { plan, graphSnapshot: document }
    } },
  }
  ctx.effect(() => ctx.catalog.registerWorkflow(workflow))
}
