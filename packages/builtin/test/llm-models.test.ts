import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { randomUUID } from 'node:crypto'
import Catalog from '../src/catalog.js'
import Settings from '../src/settings.js'
import Models from '../src/llm-models.js'
import Http from '../src/http.js'
import Auth from '../src/auth.js'
import * as ModelsApi from '../src/llm-models-api.js'
import { catalogProviderIds, catalogProviderTakesApiKey } from '../src/harness-llm/catalog.js'

async function setup(t: any, initial: any = {}, http = false) {
  const ctx = new Context(), raw: any = { connections: [], ...initial }, secrets = new Map<string, string>()
  const sessions = new Map<string, any>()
  const fiber = await ctx.plugin(async context => {
    await context.plugin(services => {
    services.reflect.provide('store', { async call(method: string, params: any = {}) {
      if (method === 'auth.validate') return { cookieName: 'test-session', sessionTtlSeconds: 1000, cookieSecure: false, cookieSameSite: 'lax', credentialVersion: 'test' }
      if (method === 'auth.get_session') return sessions.get(params.token_hash) ?? null
      if (method === 'auth.create_session') { sessions.set(params.token_hash, params); return }
      if (method === 'auth.delete_expired_sessions') return
      if (method === 'settings.raw') return structuredClone(raw)
      if (method === 'settings.get') return { defaults: null, connections: raw.connections, ui_language: 'en' }
      if (method === 'settings.write') { raw[params.key] = structuredClone(params.value); return }
      throw new Error('Unexpected store method ' + method)
    } })
    services.reflect.provide('secrets', { get: async (ref: string) => secrets.get(ref) ?? null, set: async (ref: string, value: string) => { secrets.set(ref, value) }, delete: async (ref: string) => { secrets.delete(ref) } })
    })
    await context.plugin(Catalog)
    await context.plugin(Settings)
    await context.plugin(Models)
    if (http) { await context.plugin(Http, { host: '127.0.0.1', port: 0 }); await context.plugin(Auth); await context.plugin(ModelsApi) }
  })
  t.after(() => fiber.dispose())
  if (http) ctx.emit('app/ready')
  return { ctx, raw, secrets }
}
const profile = { api: 'openai-completions', baseURL: 'https://example.invalid/v1', apiKeyEnv: 'YOUDUB_TEST_KEY', models: [{ id: 'text-model', maxTokens: 70_000 }] }
const set = (ctx: Context, id: string, value: any, revision?: number) => ctx.models.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['providers', id], value }], expectedRevision: revision })

test('the complete Harness provider directory is configurable and custom protocols use its serialized schema', async t => {
  const { ctx } = await setup(t)
  assert.deepEqual(ctx.models.providers().providers.map(item => item.provider), catalogProviderIds().filter(catalogProviderTakesApiKey))
  assert.ok(ctx.models.providers().providers.length > 10)
  assert.ok(ctx.models.providers().providers.every(item => !item.active))
  const namespace = ctx.models.describe().namespaces[0]
  assert.ok(namespace.schema.refs)
  const saved = await set(ctx, 'custom', profile, namespace.revision)
  assert.equal(saved.value.providers.custom.api, 'openai-completions')
  assert.equal(ctx.catalog.provider('llm.custom').describe().available, false)
  assert.match(ctx.catalog.provider('llm.custom').describe().unavailableReason!, /credential/i)
  await assert.rejects(set(ctx, 'other', profile, namespace.revision), { code: 'settings-conflict' })
  await assert.rejects(set(ctx, 'bad', { ...profile, api: 'not-a-protocol' }), { code: 'settings-rejected' })
})

test('credential edits and provider edits preserve snapshots already pinned by tasks', async t => {
  const { ctx } = await setup(t)
  await set(ctx, 'custom', profile)
  await ctx.models.credentialsSet('YOUDUB_TEST_KEY', 'test-secret-first')
  const original = await ctx.settings.snapshot()
  const task: any = { connections: original.connections.filter(item => item.adapter === 'llm.custom'), credentialRefs: original.credentialRefs }
  assert.equal((await ctx.settings.credentials(task))['llm.custom'].api_key, 'test-secret-first')
  const publicState = await ctx.models.credentialsDescribe({ refs: ['YOUDUB_TEST_KEY'] })
  assert.equal(publicState.credentials.YOUDUB_TEST_KEY.hint, 'test-s****')
  assert.ok(!JSON.stringify(publicState).includes('test-secret-first'))
  await ctx.models.credentialsSet('YOUDUB_TEST_KEY', 'test-secret-second')
  await set(ctx, 'custom', { ...profile, baseURL: 'https://other.invalid/v1' })
  const saved = (await ctx.settings.credentials(task))['llm.custom']
  assert.equal(saved.api_key, 'test-secret-first')
  assert.equal(saved.profile!.baseURL, profile.baseURL)
  assert.notEqual(ctx.models.snapshot().credentialRefs['llm.custom'], original.credentialRefs['llm.custom'])
  await ctx.models.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'custom'] }] })
  assert.equal(ctx.catalog.provider('llm.custom').describe().legacy, true)
  assert.equal((await ctx.settings.credentials(task))['llm.custom'].api_key, 'test-secret-first')
  assert.ok(!ctx.models.providers().providers.some(item => item.provider === 'custom'))
})

test('old OpenAI settings migrate once into an editable profile without exposing or replacing the pinned secret', async t => {
  const legacyRef = randomUUID()
  const { ctx, raw } = await setup(t, { connections: [{ adapter: 'openai', base_url: 'https://old.invalid/v1', model: 'old-model', credential_ref: legacyRef }] })
  const saved = ctx.models.describe().namespaces[0].value.providers['openai-compatible']
  assert.equal(saved.baseURL, 'https://old.invalid/v1')
  assert.equal(saved.models![0].id, 'old-model')
  assert.equal(ctx.models.snapshot().credentialRefs['llm.openai-compatible'], legacyRef)
  assert.equal(raw.connections[0].credential_ref, legacyRef)
  assert.deepEqual((await ctx.settings.read()).connections, [])
  await assert.rejects(ctx.settings.patch({ connection: { adapter: 'openai', model: 'new' } }), { code: 'LEGACY_CONNECTION_READ_ONLY' })
})

test('low-capacity models remain listed with an incompatibility and missing unrelated credentials do not block snapshots', async t => {
  const { ctx } = await setup(t)
  await set(ctx, 'limited', { ...profile, models: [{ id: 'small', maxTokens: 4096 }, { id: 'large', maxTokens: 70000 }] })
  const description = ctx.catalog.provider('llm.limited').describe()
  assert.equal(description.models!.length, 2)
  assert.equal(description.models![0].available, false)
  assert.match(description.models![0].unavailableReason, /65535/)
  assert.doesNotThrow(() => ctx.models.snapshot())
  assert.deepEqual(await ctx.settings.credentials({ connections: [], credentialRefs: {} } as any), {})
})

test('readiness requires native authentication and a compatible model, and an empty old connection creates no profile', async t => {
  const { ctx } = await setup(t, { connections: [{ adapter: 'openai', base_url: '', credential_ref: null }] })
  assert.deepEqual(ctx.models.describe().namespaces[0].value.providers, {})
  await set(ctx, 'custom', profile)
  assert.equal(ctx.models.providers().providers.find(item => item.provider === 'custom')!.active, false)
  await ctx.models.credentialsSet('YOUDUB_TEST_KEY', 'fixture-credential')
  assert.equal(ctx.models.providers().providers.find(item => item.provider === 'custom')!.active, true)
  await set(ctx, 'custom', { ...profile, models: [{ id: 'small', maxTokens: 4096 }] })
  assert.equal(ctx.models.providers().providers.find(item => item.provider === 'custom')!.active, false)
  assert.match(ctx.models.providers().providers.find(item => item.provider === 'custom')!.unavailableReason!, /65535/)
  await set(ctx, 'unauthenticated', { api: 'openai-completions', baseURL: 'http://127.0.0.1:1234/v1', models: [{ id: 'model' }] })
  assert.equal(ctx.models.providers().providers.find(item => item.provider === 'unauthenticated')!.active, false)
  assert.match(ctx.catalog.provider('llm.unauthenticated').describe().unavailableReason!, /API key/)
})

test('discovery uses saved credentials only for the saved endpoint and protocol; draft keys are explicit', async t => {
  const { ctx } = await setup(t)
  await set(ctx, 'custom', profile)
  await ctx.models.credentialsSet('YOUDUB_TEST_KEY', 'saved-discovery-key')
  const received: { url: string; authorization: string | null }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    received.push({ url, authorization: new Headers(options.headers).get('authorization') })
    return new Response(JSON.stringify({ data: [{ id: 'listed-model', max_output_tokens: 70000 }] }), { headers: { 'content-type': 'application/json' } })
  })
  const input = { settingsNs: 'llm-pi-ai', provider: 'custom', baseURL: profile.baseURL, api: profile.api }
  assert.equal((await ctx.models.discover(input)).models[0].id, 'listed-model')
  assert.equal(received[0].authorization, 'Bearer saved-discovery-key')
  await assert.rejects(ctx.models.discover({ ...input, baseURL: 'https://another.invalid/v1' }), { code: 'DISCOVERY_CREDENTIAL_REQUIRED' })
  await assert.rejects(ctx.models.discover({ ...input, api: 'openai-responses' }), { code: 'DISCOVERY_CREDENTIAL_REQUIRED' })
  assert.equal(received.length, 1)
  await ctx.models.discover({ ...input, baseURL: 'https://another.invalid/v1', apiKey: 'explicit-draft-key' })
  assert.equal(received[1].authorization, 'Bearer explicit-draft-key')
  const known = await ctx.models.discover({ settingsNs: 'llm-pi-ai', provider: 'openai' })
  assert.ok(known.models.length > 0)
  assert.equal(received.length, 2, 'known providers use the Harness catalog without an HTTP probe')
})

test('model HTTP settings and credential mutations require the existing session and CSRF guard', async t => {
  const { ctx } = await setup(t, {}, true)
  const address = ctx.http.address!
  assert.equal((await fetch(address + '/api/v2/models/providers')).status, 401)
  const auth = await fetch(address + '/api/auth/session'), session = await auth.json() as any
  const cookie = auth.headers.get('set-cookie')!.split(';')[0]
  const body = JSON.stringify({ ns: 'llm-pi-ai', expectedRevision: 0, ops: [{ op: 'set', path: ['providers', 'http-fixture'], value: profile }] })
  assert.equal((await fetch(address + '/api/v2/models/settings', { method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body })).status, 403)
  const headers = { Cookie: cookie, 'X-CSRF-Token': session.csrf_token, 'Content-Type': 'application/json' }
  const response = await fetch(address + '/api/v2/models/settings', { method: 'PATCH', headers, body })
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await response.json() as any).revision, 1)
  const conflict = await fetch(address + '/api/v2/models/settings', { method: 'PATCH', headers, body })
  assert.equal(conflict.status, 409); assert.equal((await conflict.json() as any).error.code, 'settings-conflict')
  assert.equal((await fetch(address + '/api/v2/models/credentials/YOUDUB_TEST_KEY', { method: 'PUT', headers, body: JSON.stringify({ value: 'http-fixture-secret' }) })).status, 200)
  const described = await fetch(address + '/api/v2/models/credentials/describe', { method: 'POST', headers, body: JSON.stringify({ refs: ['YOUDUB_TEST_KEY'] }) })
  const text = await described.text(); assert.ok(!text.includes('http-fixture-secret')); assert.match(text, /http-f\*\*\*\*/)
  const providers = await fetch(address + '/api/v2/models/providers', { headers })
  assert.equal((await providers.json() as any).providers.find((item: any) => item.provider === 'http-fixture').active, true)
  assert.equal((await fetch(address + '/api/v2/models/credentials/YOUDUB_TEST_KEY', { method: 'DELETE', headers })).status, 200)
  assert.equal(ctx.models.providers().providers.find(item => item.provider === 'http-fixture')!.active, false)
})
