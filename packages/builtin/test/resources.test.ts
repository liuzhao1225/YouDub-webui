import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import Http from '../src/http.js'
import Auth from '../src/auth.js'
import Setup from '../src/setup.js'
import { EnvironmentSetup } from '../src/setup-environment.js'
import { builtinResources } from '../src/runtime-resources.js'
import { DownloadClient } from '../src/setup-download.js'

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) { if (Date.now() > deadline) throw new Error('resource test timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
}

test('authenticated resource APIs validate catalog selections and share pause/resume without exposing setup tokens', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-resource-api-'))
  const previous = process.env.YOUDUB_DESKTOP_DATA_DIR
  const prepared: string[][] = [], downloads: string[] = [], sessions = new Map<string, any>()
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(this: EnvironmentSetup, groups = ['base']) {
    prepared.push(groups)
    this.steps = [{ id: 'python', name: 'Python 3.12', status: 'ready' }, { id: 'dependencies', name: '运行依赖', status: 'ready' }]
  })
  t.mock.method(EnvironmentSetup.prototype, 'probe', async (action: string) => {
    if (action === 'models') return { whisper: { models: [], unavailable_reason: 'Whisper tiny 未安装' } }
    if (action === 'acceleration-plan') return { installed: true, detail: 'Apple MPS：安装后检查实际运算能力' }
    if (action === 'acceleration') return { backend: 'mps', detail: 'Apple MPS · MPS（运算检查通过）', devices: [{ available: true }] }
    return { missing: [], media: true, punkt: true, demucsSource: true }
  })
  t.mock.method(DownloadClient.prototype, 'download', async (_file: unknown, target: string, signal: AbortSignal) => {
    downloads.push(target)
    await new Promise<void>((_resolve, reject) => signal.aborted ? reject(signal.reason) : signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const ctx = new Context()
  const app = await ctx.plugin(async function resourceApiTest(owner) {
    owner.reflect.provide('youdubWorker', { run: async () => { throw new Error('No external processes in this test') } })
    owner.reflect.provide('loader', { create: async () => {}, await: async () => {}, *entries() {} })
    owner.reflect.provide('catalog', {
      provider: () => ({ probe: async () => ({}) }),
      listProviders: () => [{ id: 'youdub.media', resources: builtinResources('youdub.media'), execution: 'local', available: true, models: [] },
        { id: 'whisper', resources: builtinResources('whisper'), execution: 'local', label: 'Whisper', available: false, models: [] },
        { id: 'openai', resources: builtinResources('openai'), execution: 'remote', available: false, models: [] }],
    })
    owner.reflect.provide('store', { call: async (method: string, args: any) => {
      if (method === 'auth.validate') return { cookieName: 'resource_session', sessionTtlSeconds: 3600, cookieSecure: false, cookieSameSite: 'lax', credentialVersion: 'test' }
      if (method === 'auth.create_session') { sessions.set(args.token_hash, args); return }
      if (method === 'auth.get_session') return sessions.get(args.token_hash)
      if (method === 'auth.delete_expired_sessions') return
      throw new Error(`Unexpected store call: ${method}`)
    } })
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Auth)
    await owner.plugin(Setup, { root, repoRoot: resolve('.'), python: '/unused/python', version: '0.0.7', entries: [] })
  })
  t.after(async () => {
    await app.dispose(); await rm(root, { recursive: true })
    if (previous === undefined) delete process.env.YOUDUB_DESKTOP_DATA_DIR
    else process.env.YOUDUB_DESKTOP_DATA_DIR = previous
  })
  ctx.emit('app/ready')
  await waitFor(() => ctx.setup.snapshot().phase === 'ready')
  const base = ctx.http.address!
  assert.equal((await fetch(base + '/api/v2/resources')).status, 401)
  assert.equal((await fetch(base + '/api/setup')).status, 200, 'pre-session setup access keeps its original boundary')
  const session = await fetch(base + '/api/auth/session')
  const cookie = session.headers.get('set-cookie')!.split(';')[0]!
  const csrf = (await session.json() as any).csrf_token
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + '/api/v2/resources/' + path, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, body: JSON.stringify(body),
  })
  assert.equal((await post('check', { selections: [] }, { 'X-CSRF-Token': '' })).status, 403)
  assert.equal((await post('prepare', { selections: [] }, { Origin: 'https://untrusted.example' })).status, 403)
  const inventory = await (await fetch(base + '/api/v2/resources', { headers: { Cookie: cookie } })).json() as any
  assert.ok(!('token' in inventory))
  assert.deepEqual(inventory.items.map((item: any) => item.providerId), ['youdub.media', 'whisper'])
  assert.deepEqual(inventory.models.map((item: any) => item.id), ['whisper'])
  assert.equal(downloads.length, 0)
  assert.equal((await post('check', { selections: [{ providerId: 'missing' }] })).status, 422)
  assert.equal((await post('prepare', { selections: [{ providerId: 'whisper', model: 'not-in-catalog' }] })).status, 422)
  assert.equal((await post('prepare', { selections: [{ providerId: 'whisper', model: 'tiny', url: 'https://untrusted.example' }] })).status, 422)
  const selections = [{ providerId: 'whisper', model: 'tiny' }]
  const checked = await (await post('check', { selections })).json() as any
  assert.equal(checked.status, 'missing')
  assert.ok(checked.environment.some((step: any) => step.id === 'acceleration' && step.status === 'ready' && step.detail === 'Apple MPS · MPS（运算检查通过）'))
  assert.ok(!JSON.stringify(checked).includes('安装后检查实际运算能力'))
  assert.equal(downloads.length, 0, 'checking never downloads')
  assert.equal((await post('prepare', { selections })).status, 200)
  await waitFor(() => downloads.length === 1)
  assert.deepEqual(prepared, [['base'], ['base', 'media', 'whisper']])
  assert.equal((await post('action', { action: 'pause', id: 'demucs' })).status, 422)
  assert.equal((await post('action', { action: 'pause', id: 'whisper' })).status, 200)
  const paused = await (await fetch(base + '/api/v2/resources', { headers: { Cookie: cookie } })).json() as any
  assert.equal(paused.models[0].status, 'paused', 'inventory reads preserve the explicit pause')
  assert.equal((await post('action', { action: 'resume', id: 'whisper' })).status, 200)
  await waitFor(() => downloads.length === 2)
})

test('declared resource groups work for external providers, share probes, and retain unavailable causes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'youdub-declared-resources-'))
  const previous = process.env.YOUDUB_DESKTOP_DATA_DIR
  const inspections: string[][] = [], refreshed: string[] = []
  let available = true
  t.mock.method(EnvironmentSetup.prototype, 'prepare', async function(this: EnvironmentSetup) {
    this.steps = [{ id: 'python', name: 'Python 3.12', status: 'ready' }]
  })
  t.mock.method(EnvironmentSetup.prototype, 'probe', async (action: string, groups: string[]) => {
    if (action === 'verify') return {}
    assert.equal(action, 'resources')
    inspections.push(groups)
    return { missing: [], media: true, punkt: true, demucsSource: true }
  })
  const ctx = new Context()
  const app = await ctx.plugin(async function resourceMetadataTest(owner) {
    owner.reflect.provide('youdubWorker', {})
    owner.reflect.provide('loader', { create: async () => {}, await: async () => {}, *entries() {} })
    owner.reflect.provide('catalog', {
      provider: (id: string) => ({ probe: async () => { refreshed.push(id) } }),
      listProviders: () => ['external.first', 'external.second'].map(id => ({
        id, resources: { dependencyGroups: [] }, execution: 'local', available,
        unavailableReason: available ? null : 'provider probe failed: missing executable', models: [{ id: 'custom' }],
      })),
    })
    await owner.plugin(Http, { host: '127.0.0.1', port: 0 })
    await owner.plugin(Setup, { root, repoRoot: resolve('.'), python: '/unused/python', version: '0.0.7', entries: [] })
  })
  t.after(async () => {
    await app.dispose(); await rm(root, { recursive: true })
    if (previous === undefined) delete process.env.YOUDUB_DESKTOP_DATA_DIR
    else process.env.YOUDUB_DESKTOP_DATA_DIR = previous
  })
  ctx.emit('app/ready')
  await waitFor(() => ctx.setup.snapshot().phase === 'ready')
  const selections = [{ providerId: 'external.first', model: 'custom' }, { providerId: 'external.second', model: 'custom' }]
  const ready = await ctx.setup.checkResources(selections)
  assert.equal(ready.status, 'ready')
  assert.ok(ready.requirements.every(item => item.automatic))
  assert.deepEqual(inspections, [['base']], 'identical declared dependency groups share one inspection')
  assert.deepEqual(refreshed, ['external.first', 'external.second'])
  available = false
  const failed = await ctx.setup.checkResources(selections)
  assert.equal(failed.status, 'missing')
  assert.ok(failed.requirements.every(item => !item.ready && item.reason?.includes('missing executable')))
})
