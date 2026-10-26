import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AppError, type JsonObject } from '@youdub/sdk'
import Catalog from '../src/catalog.js'
import { Processes, Settings } from './helpers/native-services.js'
import Store from '../src/store.js'
import * as Localize from '../src/workflow-localize.js'
import { operations } from '../src/media-contracts.js'
import { validateMediaCorrection } from '../src/node-contracts.js'
import { inspectGraph } from '../src/workflow-graph.js'
import { legacyDefaultsDocument, legacyDefaultsWorkflowId, migrateLegacyDefaults } from '../src/legacy-defaults-migration.js'
import { workflowTemplates } from '../src/workflow-templates.js'

const selection = (adapter: string, model: string, device = 'cpu') => ({ adapter, model, device })
const defaults = (mode = 'subtitles', voice = 'source_clone', background = false, align = false): JsonObject => ({
  source_language: 'auto', target_language: 'ja', output_mode: mode, keep_background: background,
  asr: { ...selection('whisper', 'old-small', 'mps'), initial_prompt: 'Names: YouDub' }, translation: selection('openai', 'qwen3-max', 'remote'),
  tts: mode === 'subtitles' ? null : { ...selection('voxcpm', 'old-voice'), voice: voice === 'source_clone' ? { mode: voice } : { mode: voice, id: 'speaker-a' } },
  separation: mode !== 'subtitles' && (background || voice === 'source_clone') ? selection('demucs', 'old-separation') : null,
  subtitle_alignment: align ? selection('qwen_forced_aligner', 'old-aligner') : null,
})
async function setup(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-defaults-')), ctx = new Context()
  const app = await ctx.plugin(async context => {
    await context.plugin(Processes)
    await context.plugin(Store, { root, repoRoot: process.cwd(), python: process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') })
    await context.plugin(Catalog); await context.plugin(Settings)
    await context.plugin({ inject: ['catalog'], apply(scope) {
      for (const [id, kinds, capability] of [['youdub.media', ['prepare', 'reference', 'mix', 'export']], ['whisper', ['recognize'], 'asr'], ['openai', ['translate'], 'translation'], ['voxcpm', ['synthesize'], 'tts'], ['demucs', ['separate'], 'separation'], ['qwen_forced_aligner', ['align'], 'subtitle_alignment']] as const) {
        scope.effect(() => scope.catalog.registerProvider({ id,
          describe: () => ({ id, label: id, pluginId: id, pluginVersion: '1', integrity: 'fixed', capability, available: false, models: [], execution: id === 'openai' ? 'remote' : 'local', operations: kinds.map(key => operations[key]) }),
          validateCorrection: validateMediaCorrection, probe: async () => ({}), execute: async () => { throw new Error('Migration cannot execute models') },
        }))
      }
    } })
    await context.plugin(Localize, { integrity: 'fixed' })
  })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true }) })
  return ctx
}

test('all legacy modes preserve every selection and optional branch without requiring installed models', async t => {
  const ctx = await setup(t)
  for (const config of [defaults(), defaults('dubbing'), defaults('dubbing', 'preset'), defaults('both', 'preset', true, true), defaults('both', 'source_clone', false)]) {
    const validated = await ctx.store.call('settings.validate_defaults', { defaults: config })
    const document = await legacyDefaultsDocument(validated, ctx.catalog)
    const workflow = ctx.catalog.workflow('youdub.localize')
    assert.ok('plan' in workflow)
    const original = await workflow.plan({}, validated, ctx.catalog)
    assert.ok(Object.values(original.bindings).every(binding => !Object.hasOwn(binding.options, 'maxCompletionTokens')))
    assert.ok(document.nodes.every(node => !Object.hasOwn(node.config, 'maxCompletionTokens')))
    assert.deepEqual(document.nodes.map(node => node.id), original.steps.map(step => step.id))
    assert.deepEqual(inspectGraph(document, ctx.catalog, {}, false).diagnostics, [])
    for (const node of document.nodes) {
      const step = original.steps.find(step => step.id === node.id)!, binding = original.bindings[step.bindingKey]
      assert.equal(node.provider.model, binding.model); assert.equal(node.provider.device, binding.device)
      assert.equal(node.autoContinue, true)
      for (const [port, input] of Object.entries(step.input)) assert.deepEqual(document.edges.find(edge => edge.target.nodeId === node.id && edge.target.portId === port)?.source, input.from === 'task' ? { nodeId: '$inputs', portId: input.name } : { nodeId: input.stepId, portId: input.output })
    }
    assert.equal(document.nodes.find(node => node.id === 'recognize')!.config.initialPrompt, 'Names: YouDub')
    assert.equal(document.nodes.find(node => node.id === 'recognize')!.config.sourceLanguage, 'auto')
    assert.equal(document.nodes.find(node => node.id === 'translate')!.config.targetLanguage, 'ja')
    assert.equal(document.nodes.find(node => node.id === 'export')!.config.renderSubtitles, config.output_mode !== 'dubbing')
    if (config.tts) assert.deepEqual(document.nodes.find(node => node.id === 'synthesize')!.config.voice, config.tts.voice)
    if (config.tts) assert.equal(document.nodes.find(node => node.id === 'mix')!.config.keepBackground, config.keep_background)
    assert.deepEqual(document.outputs.map(output => output.id), original.outputs.map(output => output.id))
  }
})

test('migration imports persisted defaults once, keeps original data and respects later user edits and deletion', async t => {
  const ctx = await setup(t), source = defaults('both', 'preset', true, true)
  assert.equal(await migrateLegacyDefaults(ctx.store, ctx.catalog), null)
  await ctx.store.call('settings.write', { key: 'defaults', value: source })
  const state = await migrateLegacyDefaults(ctx.store, ctx.catalog)
  assert.equal(state?.status, 'complete')
  const saved = await ctx.store.call('store.workflow_get', { id: legacyDefaultsWorkflowId })
  await ctx.store.call('store.workflow_update', { id: saved.id, document: { ...saved.document, title: 'My edited workflow' }, expectedRevision: saved.revision })
  assert.deepEqual(await migrateLegacyDefaults(ctx.store, ctx.catalog), state)
  assert.equal((await ctx.store.call('store.workflow_get', { id: saved.id })).document.title, 'My edited workflow')
  await ctx.store.call('store.workflow_delete', { id: saved.id, expectedRevision: 2 })
  assert.deepEqual(await migrateLegacyDefaults(ctx.store, ctx.catalog), state)
  assert.deepEqual((await ctx.store.call('store.workflow_list')).items, [])
  assert.deepEqual((await ctx.store.call('settings.raw')).defaults, source)
})

test('unsupported stored fields and missing providers stay visible without creating a partial graph', async t => {
  const ctx = await setup(t)
  for (const source of [{ ...defaults(), unexpected: true }, { ...defaults(), translation: selection('missing-provider', 'old-model', 'remote') }]) {
    await ctx.store.call('settings.write', { key: 'defaults', value: source })
    const state = await migrateLegacyDefaults(ctx.store, ctx.catalog)
    assert.equal(state?.status, 'blocked')
    assert.ok(state?.status === 'blocked' && state.diagnostics.some(item => item.field === ('unexpected' in source ? 'unexpected' : 'translation.adapter')))
    assert.deepEqual((await ctx.store.call('store.workflow_list')).items, [])
    assert.deepEqual((await ctx.store.call('settings.raw')).defaults, source)
  }
})

test('existing workflow ID collision is visible and never overwrites the user document', async t => {
  const ctx = await setup(t)
  await ctx.store.call('settings.write', { key: 'defaults', value: defaults() })
  const document = await legacyDefaultsDocument(defaults(), ctx.catalog)
  document.title = 'Existing user work'
  await ctx.store.call('store.workflow_create', { document })
  const state = await migrateLegacyDefaults(ctx.store, ctx.catalog)
  assert.equal(state?.status, 'blocked')
  assert.equal((await ctx.store.call('store.workflow_get', { id: document.id })).document.title, document.title)
})

test('a node contract that cannot preserve a saved option blocks migration with that field', async t => {
  const ctx = await setup(t), provider = ctx.catalog.provider('whisper')
  const description = structuredClone(provider.describe())
  delete description.operations[0].node!.configSchema.properties.initialPrompt
  provider.describe = () => description
  await ctx.store.call('settings.write', { key: 'defaults', value: defaults() })
  const state = await migrateLegacyDefaults(ctx.store, ctx.catalog)
  assert.ok(state?.status === 'blocked' && state.diagnostics.some(item => item.nodeId === 'recognize' && item.field === 'initialPrompt'))
  assert.deepEqual((await ctx.store.call('store.workflow_list')).items, [])
})

test('storage failure propagates and cannot become a completed migration', async t => {
  const ctx = await setup(t)
  await ctx.store.call('settings.write', { key: 'defaults', value: defaults() })
  const store = { root: ctx.store.root, call: async <T = any>(method: string, params?: JsonObject): Promise<T> => {
    if (method === 'store.workflow_migrate_defaults') throw new AppError('SQLITE_ERROR', 'disk full', 500)
    return ctx.store.call<T>(method, params)
  } }
  await assert.rejects(migrateLegacyDefaults(store, ctx.catalog), /disk full/)
  assert.equal((await ctx.store.call('settings.raw'))['plugin:youdub.localize'], undefined)
})

test('official templates use their own configuration and only initialize unbound connection models', async t => {
  const ctx = await setup(t)
  const settings = { defaults: defaults(), connections: [{ adapter: 'openai', model: 'qwen3-max' }] }
  const templates = workflowTemplates(ctx.catalog, settings)
  assert.equal(templates[0].document.nodes.find(node => node.id === 'recognize')!.provider.model, 'tiny')
  assert.equal(templates[0].document.nodes.find(node => node.id === 'recognize')!.config.sourceLanguage, 'auto')
  assert.equal(templates[0].document.nodes.find(node => node.id === 'translate')!.config.targetLanguage, 'zh')
  assert.equal(templates[0].document.nodes.find(node => node.id === 'translate')!.provider.model, 'qwen3-max')
  assert.equal(templates[0].document.nodes.find(node => node.id === 'translate')!.provider.device, 'remote')
  const frozen = structuredClone(templates[0].document)
  workflowTemplates(ctx.catalog, { ...settings, connections: [{ adapter: 'openai', model: 'changed-model' }] })
  assert.deepEqual(templates[0].document, frozen)
})
