import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import Catalog from '../src/catalog.js'
import * as Localize from '../src/workflow-localize.js'

test('localize requires available media tools before accepting any output mode', async t => {
  const ctx = new Context()
  let available = false
  const app = await ctx.plugin(async context => {
    context.reflect.provide('settings', { read: async () => ({ defaults: null, connections: [] }) })
    await context.plugin(Catalog)
    await context.plugin({ inject: ['catalog'], apply(scope) {
      for (const capability of ['download', 'media', 'asr', 'translation', 'tts', 'separation']) {
        const id = ['download', 'media'].includes(capability) ? `youdub.${capability}` : capability
        scope.effect(() => scope.catalog.registerProvider({
        id,
        describe: () => ({ id, label: id, capability, adapter: id, pluginId: id, pluginVersion: '1', integrity: 'test', operations: [], available: capability === 'media' ? available : true, unavailableReason: 'ffmpeg unavailable', models: [{ id: 'test', devices: ['cpu'], source_languages: ['en'], target_languages: ['zh'], voice_modes: ['source_clone'] }] }),
        probe: async () => ({}), execute: async () => { throw new Error('No execution expected') },
        }))
      }
    } })
    await context.plugin(Localize, { integrity: 'test' })
  })
  t.after(() => app.dispose())
  const defaults = ctx.catalog.describe().workflows[0].defaults
  assert.equal(defaults.asr.adapter, 'asr')
  assert.equal(defaults.translation.adapter, 'translation')
  const select = (adapter: string) => ({ adapter, model: 'test', device: 'cpu' })
  for (const output_mode of ['subtitles', 'dubbing', 'both']) {
    const config = { source_language: 'en', target_language: 'zh', output_mode, keep_background: false, asr: select('asr'), translation: select('translation'), tts: output_mode === 'subtitles' ? null : { ...select('tts'), voice: { mode: 'source_clone' } }, separation: output_mode === 'subtitles' ? null : select('separation') }
    const workflow = ctx.catalog.workflow('youdub.localize')
    assert.ok('plan' in workflow)
    available = false
    assert.deepEqual(await workflow.validate({ video: { id: "input-video", schemaId: "video/mp4/v1" } }, config, ctx.catalog), [{ code: 'INVALID_CONFIG', message: 'ffmpeg unavailable', field: 'video' }])
    available = true
    const linked = { ...config, source_url: 'https://youtu.be/jNQXAC9IVRw' }
    assert.deepEqual(await workflow.validate({}, linked, ctx.catalog), [])
    assert.ok((await workflow.validate({}, config, ctx.catalog)).some(error => error.field === 'video'))
    assert.ok((await workflow.validate({ video: { id: 'input-video', schemaId: 'video/mp4/v1' } }, linked, ctx.catalog)).some(error => error.field === 'video'))
    const plan = await workflow.plan({}, linked, ctx.catalog)
    assert.ok(Object.values(plan.bindings).every(binding => !Object.hasOwn(binding.options, 'maxCompletionTokens')))
    assert.equal(plan.steps[0].operation, 'media.download/v1')
    assert.deepEqual(plan.steps[0].input, { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' })
    assert.equal(plan.bindings.download.options.proxyPort, 0)
    const proxied = await workflow.plan({}, { ...linked, source_proxy_port: 7897 }, ctx.catalog)
    assert.equal(proxied.bindings.download.options.proxyPort, 7897)
    for (const id of ['prepare', 'export']) assert.deepEqual(plan.steps.find(step => step.id === id)?.input.video, { from: 'step', stepId: 'download', output: 'video' })
    const uploaded = await workflow.plan({ video: { id: 'input-video', schemaId: 'video/mp4/v1' } }, config, ctx.catalog)
    assert.equal(uploaded.steps[0].id, 'prepare')
    assert.deepEqual(uploaded.steps[0].input.video, { from: 'task', name: 'video' })
    assert.deepEqual(await workflow.validate({ video: { id: "input-video", schemaId: "video/mp4/v1" } }, config, ctx.catalog), [])
  }
})
