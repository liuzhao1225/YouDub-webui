import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import type { GraphWorkflowDefinition, WorkflowDocument } from '@youdub/sdk'
import Catalog from '../src/catalog.js'
import * as Graph from '../src/workflow-graph.js'
import { operations } from '../src/media-contracts.js'
import { validateMediaCorrection } from '../src/node-contracts.js'
import { parseWorkflowDocument } from '../src/workflow-document.js'
import { workflowTemplates } from '../src/workflow-templates.js'

async function setup(t: any) {
  const ctx = new Context()
  const app = await ctx.plugin(async context => {
    await context.plugin(scope => scope.reflect.provide('settings', { read: async () => ({ connections: [{ adapter: 'openai', base_url: 'https://example.invalid/v1', has_api_key: true }] }) }))
    await context.plugin(Catalog)
    await context.plugin({ inject: ['catalog'], apply(scope) {
      for (const [id, kinds, capability] of [['youdub.media', ['prepare', 'reference', 'mix', 'export', 'importSubtitles']], ['youdub.download', ['download']], ['whisper', ['recognize'], 'asr'], ['openai', ['translate'], 'translation'], ['voxcpm', ['synthesize'], 'tts'], ['demucs', ['separate'], 'separation']] as const) {
        scope.effect(() => scope.catalog.registerProvider({
          id, describe: () => ({ id, label: id, pluginId: id, pluginVersion: '1', integrity: 'sha256:test', operations: kinds.map(key => operations[key]), available: true, capability, execution: id === 'openai' ? 'remote' : 'local', models: capability ? [{ id: ({ whisper: 'tiny', demucs: 'htdemucs', voxcpm: 'VoxCPM2' } as Record<string, string>)[id] ?? 'test', devices: ['cpu'], source_languages: ['en', 'ja'], target_languages: ['zh', 'ja'], voice_modes: ['source_clone', 'preset'], voices: [{ id: 'v1', languages: ['zh', 'ja'] }] }] : undefined }),
          validateCorrection: validateMediaCorrection, probe: async () => ({}), execute: async () => { throw new Error('Compilation must not execute providers') },
        }))
      }
    } })
    await context.plugin(Graph, { integrity: 'sha256:graph' })
  })
  t.after(() => app.dispose())
  const compile = async (document: WorkflowDocument, nodeRuntimeInputs = {}, inputs = { video: { id: 'source', schemaId: 'file/v1' } }) => (ctx.catalog.workflow('youdub.graph') as GraphWorkflowDefinition).graph.compile({ document, nodeRuntimeInputs, inputs }, ctx.catalog)
  const templates = workflowTemplates(ctx.catalog, {})
  return { ctx, compile, templates, subtitles: templates[0].document }
}

test('independent templates compile without mutating graph and only freeze selected resources', async t => {
  const { templates, compile } = await setup(t)
  const plans = await Promise.all(templates.map(async item => {
    const original = structuredClone(item.document)
    const result = await compile(item.document)
    assert.deepEqual(item.document, original)
    assert.equal(result.plan.config.graph, true)
    assert.ok(result.plan.steps.every(step => step.bindingKey === step.id))
    assert.equal(result.plan.bindings.translate.options.maxCompletionTokens, 65535)
    assert.ok(result.plan.steps.find(step => step.id === 'translate')!.input.transcript.from === 'step')
    return result.plan
  }))
  assert.ok(plans[0].steps.every(step => !['synthesize', 'separate', 'reference', 'mix'].includes(step.id)))
  assert.deepEqual(templates.map(item => item.id), ['youdub.subtitles', 'youdub.dubbing', 'youdub.subtitles-dubbing'])
  assert.equal(plans[1].bindings.export.options.outputMode, 'dubbing')
  assert.equal(plans[2].bindings.export.options.outputMode, 'both')
  const reviewed = structuredClone(templates[0].document)
  reviewed.nodes.find(node => node.id === 'recognize')!.autoContinue = false
  reviewed.nodes.find(node => node.id === 'translate')!.autoContinue = false
  const reviewedPlan = (await compile(reviewed)).plan
  assert.equal(reviewedPlan.steps.find(step => step.id === 'recognize')?.autoContinue, false)
  assert.equal(reviewedPlan.steps.find(step => step.id === 'translate')?.autoContinue, false)
  assert.equal(plans[0].steps.find(step => step.id === 'recognize')?.autoContinue, true)
})

test('new templates use a configured model provider and reject a model with insufficient output capacity', async t => {
  const { ctx, compile } = await setup(t)
  const provider = {
    id: 'llm.custom', label: 'Custom gateway', pluginId: 'youdub.models', pluginVersion: '1', integrity: 'sha256:models',
    operations: [operations.translate], capability: 'translation', execution: 'remote' as const, available: true,
    models: [
      { id: 'small', devices: ['remote'], available: false, unavailableReason: 'Maximum output is below 65535.', source_languages: ['en', 'ja'], target_languages: ['zh', 'ja'] },
      { id: 'translation-large', devices: ['remote'], available: true, source_languages: ['en', 'ja'], target_languages: ['zh', 'ja'] },
    ],
  }
  const plugin = await ctx.plugin({ inject: ['catalog'], apply(scope) {
    scope.effect(() => scope.catalog.registerProvider({ id: provider.id, describe: () => provider,
      probe: async () => ({ available: true }), validateCorrection: validateMediaCorrection,
      execute: async () => { throw new Error('Compilation must not execute providers') },
    }))
  } })
  t.after(() => plugin.dispose())
  const document = workflowTemplates(ctx.catalog, {})[0].document
  const node = document.nodes.find(node => node.id === 'translate')!
  assert.deepEqual(node.provider, { id: 'llm.custom', model: 'translation-large', device: 'remote' })
  const result = await compile(document)
  assert.equal(result.plan.bindings.translate.providerId, provider.id)
  node.provider.model = 'small'
  assert.ok(Graph.inspectGraph(document, ctx.catalog).diagnostics.some(item => item.nodeId === 'translate' && item.message.includes('65535')))
  await assert.rejects(compile(document))
})

test('graph validation locates incompatible edges, cycles, missing ports and disconnected nodes', async t => {
  const { ctx, subtitles } = await setup(t)
  const invalid = structuredClone(subtitles)
  invalid.edges.find(edge => edge.target.nodeId === 'translate')!.source.portId = 'raw'
  invalid.edges.push({ id: 'cycle', source: { nodeId: 'export', portId: 'video' }, target: { nodeId: 'prepare', portId: 'video' } })
  invalid.nodes.push({ ...structuredClone(invalid.nodes[1]), id: 'detached' })
  const errors = Graph.inspectGraph(invalid, ctx.catalog).diagnostics
  assert.ok(errors.some(item => item.edgeId === 'recognize-translate' && /Incompatible/.test(item.message)))
  assert.ok(errors.some(item => /cycle/.test(item.message)))
  assert.ok(errors.some(item => item.nodeId === 'detached' && /final output/.test(item.message)))
  assert.ok(errors.some(item => item.nodeId === 'detached' && item.portId === 'audio'))
})

test('unsupported source and target languages cannot compile into a task', async t => {
  const { ctx, subtitles, compile } = await setup(t)
  const document = structuredClone(subtitles)
  document.nodes.find(node => node.id === 'recognize')!.config.sourceLanguage = 'asdf'
  document.nodes.find(node => node.id === 'translate')!.config.targetLanguage = 'asdf'
  document.nodes.find(node => node.id === 'export')!.config.targetLanguage = 'asdf'
  const errors = Graph.inspectGraph(document, ctx.catalog).diagnostics
  assert.ok(errors.some(item => item.nodeId === 'recognize' && item.field === 'sourceLanguage'))
  assert.ok(errors.some(item => item.nodeId === 'translate' && item.field === 'targetLanguage'))
  await assert.rejects(compile(document))
})

test('bindings isolate two translations and exports, presentation never changes execution', async t => {
  const { subtitles, compile } = await setup(t)
  const doc = structuredClone(subtitles)
  const translate = structuredClone(doc.nodes.find(node => node.id === 'translate')!)
  translate.id = 'translate-ja'; translate.config.targetLanguage = 'ja'
  const exportNode = structuredClone(doc.nodes.find(node => node.id === 'export')!)
  exportNode.id = 'export-ja'; exportNode.config.targetLanguage = 'ja'
  doc.nodes.push(translate, exportNode)
  for (const edge of doc.edges.filter(edge => ['translate', 'export'].includes(edge.target.nodeId))) doc.edges.push({ id: edge.id + '-ja', source: { ...edge.source, nodeId: edge.source.nodeId === 'translate' ? 'translate-ja' : edge.source.nodeId }, target: { ...edge.target, nodeId: edge.target.nodeId + '-ja' } })
  doc.outputs.push({ ...structuredClone(doc.outputs[0]), id: 'video-ja', source: { nodeId: 'export-ja', portId: 'video' } })
  const first = await compile(doc)
  doc.presentation.positions = { 'export-ja': { x: -500, y: -500 } }
  const second = await compile(doc)
  assert.deepEqual(first.plan, second.plan)
  assert.equal(first.plan.bindings.translate.options.targetLanguage, 'zh')
  assert.equal(first.plan.bindings['translate-ja'].options.targetLanguage, 'ja')
  assert.equal(first.plan.bindings['export-ja'].options.targetLanguage, 'ja')
})

test('download URL is validated as per-run input and never saved in exported graph', async t => {
  const { compile, subtitles } = await setup(t)
  const doc = structuredClone(subtitles)
  doc.inputs = []
  doc.nodes.unshift({ id: 'download', type: 'youdub.download', typeVersion: '1.0.0', provider: { id: 'youdub.download' }, config: {}, autoContinue: true })
  doc.edges.forEach(edge => { if (edge.source.nodeId === '$inputs') edge.source = { nodeId: 'download', portId: 'video' } })
  const result = await compile(doc, { download: { url: 'https://youtu.be/jNQXAC9IVRw' } }, {} as any)
  assert.equal(result.plan.bindings.download.options.proxyPort, 0)
  for (const proxyPort of [1, 7897, 65535]) {
    const proxied = structuredClone(doc)
    proxied.nodes[0].config.proxyPort = proxyPort
    const configured = await compile(proxied, { download: { url: 'https://youtu.be/jNQXAC9IVRw' } }, {} as any)
    assert.equal(configured.plan.bindings.download.options.proxyPort, proxyPort)
  }
  for (const proxyPort of [-1, 65536, 1.5, '7897']) {
    const invalid = structuredClone(doc)
    invalid.nodes[0].config.proxyPort = proxyPort
    await assert.rejects(compile(invalid, { download: { url: 'https://youtu.be/jNQXAC9IVRw' } }, {} as any), /validation failed/)
  }
  assert.equal(result.plan.steps[0].input.url, 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
  assert.ok(!JSON.stringify(result.graphSnapshot).includes('youtu.be'))
  await assert.rejects(compile(doc, { download: { url: 'file:///etc/passwd' } }, {} as any), /validation failed/)
  doc.nodes[0].config.apiKey = 'secret'
  assert.throws(() => parseWorkflowDocument(doc), /apiKey/)
})

for (const end_ms of [100, 1018]) test(`correction semantics preserve source timing at ${end_ms} ms and normalize changed word timings`, () => {
  const original = { detected_language: 'en', segments: [{ id: 'a', text: 'Hello', start_ms: 0, end_ms, words: [{ text: 'Hello', start_ms: 0, end_ms }] }] }
  const request = { operation: 'speech.transcribe/v1', inputs: { mediaInfo: { duration_ms: 1000 } }, baselineOutputs: { transcript: original, raw: { id: 'raw', schemaId: 'diagnostic/json/v1' } }, patch: { transcript: { ...structuredClone(original), segments: [{ ...original.segments[0], text: 'Hello there' }] } } }
  const output = validateMediaCorrection(request) as any
  assert.equal(output.transcript.segments[0].words, null)
  assert.deepEqual(output.raw, request.baselineOutputs.raw)
  assert.equal(output.transcript.segments[0].end_ms, end_ms)
  assert.notEqual(output.transcript, original)
  request.patch.transcript.segments[0].id = 'other'
  assert.throws(() => validateMediaCorrection(request), /IDs/)
})

test('third-party nodes keep their own semantics for fields named sourceLanguage and targetLanguage', async t => {
  const { ctx, compile } = await setup(t)
  const id = 'thirdparty.text', output = { name: 'file', kind: 'artifact' as const, schemaId: 'file/v1', required: true }
  const dispose = ctx.catalog.registerProvider({ id, describe: () => ({ id, label: 'Text', pluginId: id, pluginVersion: '1', integrity: 'test', available: true,
    operations: [{ id: 'text.normalize/v1', inputSchema: { type: 'object', properties: {} }, outputs: [output], node: { type: id, version: '1', label: 'Normalize', category: 'Text', inputs: [], defaults: {}, configSchema: { type: 'object', properties: { sourceLanguage: { type: 'string' }, targetLanguage: { type: 'string' } } } } }],
  }), probe: async () => ({}), execute: async () => { throw new Error('No execution expected') } })
  t.after(dispose)
  const graph: WorkflowDocument = { format: 'youdub.workflow', formatVersion: 1, id: 'custom', title: 'Normalize',
    nodes: [{ id: 'normalize', type: id, typeVersion: '1', provider: { id }, config: { sourceLanguage: 'en', targetLanguage: 'en' }, autoContinue: true }], edges: [], inputs: [],
    outputs: [{ id: 'text', label: 'Text', kind: 'artifact', schemaId: 'file/v1', required: true, source: { nodeId: 'normalize', portId: 'file' } }], presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } } }
  const result = await (ctx.catalog.workflow('youdub.graph') as GraphWorkflowDefinition).graph.compile({ document: graph, inputs: {}, nodeRuntimeInputs: {} }, ctx.catalog)
  assert.equal(result.plan.bindings.normalize.options.targetLanguage, 'en')
})
