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
      for (const capability of ['media', 'asr', 'translation', 'tts', 'separation']) {
        const id = capability === 'media' ? 'youdub.media' : capability
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
    available = false
    assert.deepEqual(await workflow.validate({}, config, ctx.catalog), [{ code: 'INVALID_CONFIG', message: 'ffmpeg unavailable', field: 'video' }])
    available = true
    assert.deepEqual(await workflow.validate({}, config, ctx.catalog), [])
  }
})
