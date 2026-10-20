import type { Context } from 'cordis'
import Ajv from 'ajv/dist/2020.js'
import { AppError, type ArtifactRef, type CatalogService, type Diagnostic, type GraphCompileRequest, type GraphWorkflowDefinition, type JsonObject, type NodeTypeDefinition, type WorkflowDocument, type WorkflowPlan } from '@youdub/sdk'
import { videoSource } from '@youdub/sdk/video-source'
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
      else if (type.type === 'youdub.download') {
        try { runtime = { ...runtime, [node.id]: { ...runtime[node.id], url: videoSource(runtime[node.id].url).url } } }
        catch (error) { fail((error as Error).message, { nodeId: node.id, field: 'url' }) }
      }
    } else if (Object.keys(runtime[node.id] ?? {}).length) fail('This node has no runtime inputs.', { nodeId: node.id })
    const model = type.provider.models?.find(model => model.id === node.provider.model)
    if (type.provider.capability && (!node.provider.model || !node.provider.device)) fail('Select a model and device.', { nodeId: node.id, field: 'provider' })
    else if (ready && type.provider.models?.length && (!model || !model.devices?.includes(node.provider.device))) fail('Selected model or device is unavailable.', { nodeId: node.id, field: 'provider' })
    if (model) {
      if (config.sourceLanguage && config.sourceLanguage !== 'auto' && model.source_languages && !model.source_languages.includes(config.sourceLanguage)) fail('Source language is unsupported.', { nodeId: node.id, field: 'sourceLanguage' })
      if (config.targetLanguage && model.target_languages && !model.target_languages.includes(config.targetLanguage)) fail('Target language is unsupported.', { nodeId: node.id, field: 'targetLanguage' })
      if (config.voice && model.voice_modes && !model.voice_modes.includes(config.voice.mode)) fail('Voice mode is unsupported.', { nodeId: node.id, field: 'voice' })
      if (config.voice?.mode === 'preset' && !model.voices?.some((voice: any) => voice.id === config.voice.id && voice.languages.includes(config.targetLanguage))) fail('Selected voice is unavailable.', { nodeId: node.id, field: 'voice' })
    }
    if (config.targetLanguage === 'auto' || (config.sourceLanguage && config.sourceLanguage === config.targetLanguage)) fail('Select different source and target languages.', { nodeId: node.id, field: 'targetLanguage' })
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
  const upstreamConfig = (nodeId: string, portId: string) => options.get(document.edges.find(edge => edge.target.nodeId === nodeId && edge.target.portId === portId)?.source.nodeId ?? '')
  for (const node of document.nodes) {
    const type = types.get(node.id), config = options.get(node.id)
    if (!type || !config) continue
    for (const port of type.inputs) if (port.required && !connected(node.id, port.id)) fail(`Connect ${typeof port.label === 'string' ? port.label : port.id}.`, { nodeId: node.id, portId: port.id })
    if (type.type === 'youdub.synthesize' && config.voice?.mode === 'source_clone' && !connected(node.id, 'references')) fail('Source cloning requires voice references.', { nodeId: node.id, portId: 'references' })
    if (type.type === 'youdub.mix' && config.keepBackground && !connected(node.id, 'background')) fail('Background mixing requires a background input.', { nodeId: node.id, portId: 'background' })
    const translated = upstreamConfig(node.id, 'translation')
    if (translated?.targetLanguage && config.targetLanguage && translated.targetLanguage !== config.targetLanguage) fail('Target language must match the connected translation.', { nodeId: node.id, field: 'targetLanguage' })
    if (type.type === 'youdub.export') {
      const audio = connected(node.id, 'finalAudio'), timeline = connected(node.id, 'dubbedTimeline')
      if (audio !== timeline) fail('Connect final audio and its timeline together.', { nodeId: node.id, portId: 'dubbedTimeline' })
      if (!audio && !config.renderSubtitles) fail('Export requires subtitles or final audio.', { nodeId: node.id, field: 'renderSubtitles' })
      config.outputMode = audio ? config.renderSubtitles ? 'both' : 'dubbing' : 'subtitles'
    }
  }
  const inputSource = (id: string, port: string) => document.edges.find(edge => edge.target.nodeId === id && edge.target.portId === port)?.source
  const sameSource = (actual: ReturnType<typeof inputSource>, expected: ReturnType<typeof inputSource>) => actual && expected && actual.nodeId === expected.nodeId && actual.portId === expected.portId
  const expectSource = (nodeId: string, portId: string, expected: ReturnType<typeof inputSource>) => {
    if (expected && !sameSource(inputSource(nodeId, portId), expected)) fail('Connect data from the same upstream result.', { nodeId, portId })
  }
  const translatedTranscript = (id: string) => {
    const input = inputSource(id, 'translation'), type = input && types.get(input.nodeId)?.type
    return type === 'youdub.translate' ? inputSource(input!.nodeId, 'transcript') : type === 'youdub.importSubtitles' ? { nodeId: input!.nodeId, portId: 'transcript' } : undefined
  }
  for (const node of document.nodes) {
    const type = types.get(node.id)?.type
    if (['youdub.synthesize', 'youdub.align', 'youdub.export'].includes(type ?? '')) expectSource(node.id, 'transcript', translatedTranscript(node.id))
    if (type === 'youdub.synthesize') {
      const input = inputSource(node.id, 'references')
      if (input && types.get(input.nodeId)?.type === 'youdub.reference') expectSource(node.id, 'transcript', inputSource(input.nodeId, 'transcript'))
    }
    if (type === 'youdub.mix') {
      const input = inputSource(node.id, 'speechAudio')
      if (input && types.get(input.nodeId)?.type === 'youdub.synthesize') expectSource(node.id, 'transcript', inputSource(input.nodeId, 'transcript'))
    }
    if (type === 'youdub.export' || type === 'youdub.align') {
      const input = inputSource(node.id, type === 'youdub.export' ? 'finalAudio' : 'dubbedTimeline')
      if (input && types.get(input.nodeId)?.type === 'youdub.mix') {
        expectSource(node.id, type === 'youdub.export' ? 'dubbedTimeline' : 'adjustedSpeech', { nodeId: input.nodeId, portId: type === 'youdub.export' ? 'dubbedTimeline' : 'adjustedSpeech' })
        expectSource(node.id, 'transcript', inputSource(input.nodeId, 'transcript'))
        if (type === 'youdub.export') expectSource(node.id, 'mediaInfo', inputSource(input.nodeId, 'mediaInfo'))
      }
      if (type === 'youdub.export') {
        const media = inputSource(node.id, 'mediaInfo')
        if (media && types.get(media.nodeId)?.type === 'youdub.prepare') expectSource(node.id, 'video', inputSource(media.nodeId, 'video'))
      }
    }
  }
  for (const output of document.outputs) {
    const port = sourcePort(output.source.nodeId, output.source.portId)
    if (!port || output.source.nodeId === '$inputs' || port.kind !== 'artifact' || port.schemaId !== output.schemaId) fail('Final output must reference a matching artifact output.', { nodeId: output.source.nodeId, portId: output.source.portId })
    const type = types.get(output.source.nodeId), config = options.get(output.source.nodeId)
    if (type?.type === 'youdub.export' && ((['sourceSubtitles', 'translatedSubtitles'].includes(output.source.portId) && !config?.renderSubtitles) || (output.source.portId === 'audio' && !connected(output.source.nodeId, 'finalAudio')))) fail('The selected export output is not produced by this node configuration.', { nodeId: output.source.nodeId, portId: output.source.portId })
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
export async function apply(ctx: Context, plugin: { integrity: string }) {
  const workflow: GraphWorkflowDefinition = {
    id: 'youdub.graph', version: '1.0.0', pluginId: 'youdub.workflow-graph', pluginVersion: '1.0.0', integrity: plugin.integrity,
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
