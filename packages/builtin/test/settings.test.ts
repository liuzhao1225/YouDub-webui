import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import Processes from '../src/process.js'
import Store from '../src/store.js'
import Catalog from '../src/catalog.js'
import Secrets from '../src/secrets.js'
import Settings from '../src/settings.js'
import * as Api from '../src/api.js'

async function start(root: string) {
  const ctx = new Context()
  const app = await ctx.plugin(async function application(context) {
    await context.plugin(Processes)
    await context.plugin(Store, { root, repoRoot: process.cwd(), python: resolve('.venv/bin/python') })
    await context.plugin(Catalog)
    await context.plugin(Secrets)
    await context.plugin(Settings)
  })
  return { ctx, app }
}

test('plugin public settings persist independently, merge within their namespace, and emit updated snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-settings-'))
  let { ctx, app } = await start(root)
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true }) })
  const updates: any[] = []
  ctx.on('settings/updated', value => { updates.push(value) })
  await ctx.store.call('settings.write', { key: 'private-adapter-reference', value: { credential_ref: 'not-public' } })
  await ctx.settings.patch({ plugin: { id: 'example.first', config: { quality: 'normal', label: 'First' } } })
  await ctx.settings.patch({ plugin: { id: 'example.second', config: { enabled: true } } })
  const saved = await ctx.settings.patch({ plugin: { id: 'example.first', config: { quality: 'high' } } })
  assert.deepEqual(saved.plugins, { 'example.first': { quality: 'high', label: 'First' }, 'example.second': { enabled: true } })
  assert.equal(JSON.stringify(saved).includes('not-public'), false)
  assert.deepEqual(updates.at(-1), saved)
  const language = await ctx.settings.patch({ ui_language: 'zh' })
  assert.equal(language.ui_language, 'zh')
  assert.deepEqual(language.plugins, saved.plugins)
  assert.equal(updates.length, 4)
  await assert.rejects(ctx.settings.patch({ plugin: { id: 'connections', config: { value: 1 } }, ui_language: 'en' }), (error: any) => error.code === 'INVALID_CONFIG')
  await assert.rejects(ctx.settings.patch({ plugin: { id: '../connections', config: {} } }), (error: any) => error.code === 'INVALID_CONFIG')
  await assert.rejects(ctx.settings.patch({ plugin: { id: 'example.first', config: [] } }), (error: any) => error.code === 'INVALID_CONFIG')
  assert.equal(updates.length, 4)
  await app.dispose()
  ;({ ctx, app } = await start(root))
  assert.deepEqual(await ctx.settings.read(), { defaults: null, connections: [], ui_language: 'zh', plugins: saved.plugins })
})

test('settings API exposes plugin configuration only in v2 and preserves v1 response fields', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-settings-api-')), { ctx, app } = await start(root)
  const handlers = new Map<string, (request: any) => Promise<void>>()
  const support = await ctx.plugin(function support(context) {
    context.reflect.provide('http', {
      register(method: string, path: string, handler: any) { const key = method + ' ' + path; handlers.set(key, handler); return () => { handlers.delete(key) } },
      json(request: any, status: number, body: any) { request.result = { status, body } },
    })
    for (const name of ['auth', 'tasks', 'files', 'extensions']) context.reflect.provide(name, {})
  })
  const api = await ctx.plugin(Api, {})
  t.after(async () => { await api.dispose(); await support.dispose(); await app.dispose(); await rm(root, { recursive: true }) })
  const request = async (method: string, version: string, body?: any) => {
    const input = { raw: Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), result: undefined as any }
    await handlers.get(`${method} /api/${version}/settings`)!(input)
    return input.result
  }
  const patch = { plugin: { id: 'example.panel', config: { caption: 'Saved' } } }
  const saved = await request('PATCH', 'v2', patch)
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.plugins, { 'example.panel': { caption: 'Saved' } })
  assert.deepEqual((await request('GET', 'v2')).body, saved.body)
  assert.deepEqual((await request('GET', 'v1')).body, { defaults: null, connections: [], ui_language: 'en' })
  assert.deepEqual((await request('PATCH', 'v1', { ui_language: 'zh' })).body, { defaults: null, connections: [], ui_language: 'zh' })
  await assert.rejects(request('PATCH', 'v1', patch), (error: any) => error.status === 422 && error.code === 'CONTRACT_UNSUPPORTED')
  assert.deepEqual((await request('GET', 'v2')).body.plugins, saved.body.plugins)
})
