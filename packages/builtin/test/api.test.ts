import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { AppError } from '@youdub/sdk'
import Files from '../src/files.js'
import { taskApi } from './helpers/task-api.js'

// Actual Harness routes and multipart/file streams, without loading models.
async function setup(t: any, fileService = Files) {
  const root = await mkdtemp(join(tmpdir(), 'youdub-api-')), ctx = new Context()
  const created: any[] = [], reruns: any[] = []
  let unavailable = false
  let request!: ReturnType<typeof taskApi>['request']
  const app = await ctx.plugin(async context => {
    // Dependencies must be ACTIVE before awaiting their consumers. Providing
    // them on this still-loading parent leaves child plugins PENDING.
    await context.plugin(services => {
      services.reflect.provide('youdubWorker', {})
      services.reflect.provide('settings', { locked: async (action: () => Promise<any>) => action(), read: async () => ({ plugins: { 'youdub.updates': { automatic: false } } }) })
      services.reflect.provide('store', { call: async (method: string) => { if (method === 'settings.raw') return {}; throw new Error(`Unexpected store call: ${method}`) } })
      services.reflect.provide('catalog', { listProviders: () => [], describe: () => ({ workflows: [] }), workflow: () => ({ describe: () => ({ inputs: [{ name: 'document', maxBytes: 64 }] }) }) })
      services.reflect.provide('tasks', {
        assertReady() { if (unavailable) throw new AppError('TASK_RUNTIME_UNAVAILABLE', 'Queue stopped.', 503) },
        async create(input: any) { created.push(input); return { id: input.id, outputs: [] } },
        async get(id: string) { return { id, attempt: 1, outputs: [] } },
        async rerun(id: string, request: any) { reruns.push({ id, request }); return { id: request.id, outputs: [] } },
      })
    })
    await context.plugin(fileService, { root })
    await context.plugin({ inject: ['tasks', 'catalog', 'files', 'settings', 'store'], apply(scope) { request = taskApi(scope).request } })
  })
  t.after(async () => { await app.dispose(); await rm(root, { recursive: true }) })
  ctx.emit('app/ready')
  const post = (body: BodyInit, headers?: Record<string, string>) => request('/api/v2/tasks', { method: 'POST', body, headers, signal: AbortSignal.timeout(3000) })
  const form = () => {
    const data = new FormData()
    data.append('request', JSON.stringify({ id: randomUUID(), workflowId: 'test.upload', config: {} }))
    return data
  }
  return { ctx, request, created, reruns, post, form, failRuntime: () => { unavailable = true } }
}

test('API fixture waits for asynchronous dependency initialization before advertising readiness', async t => {
  let release!: () => void, entered!: () => void, ready = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  class DelayedFiles extends Files {
    async [Service.init]() { entered(); await gate; return super[Service.init]() }
  }
  const initializing = setup(t, DelayedFiles).then(value => { ready = true; return value })
  await started
  await nextTurn()
  try { assert.equal(ready, false, 'API became ready while its files dependency was still initializing') }
  finally { release() }
  const { post, form } = await initializing
  const response = await post(form())
  assert.equal(response.status, 201, await response.text())
})

test('health reports a stopped task runtime as unavailable', async t => {
  const { request, failRuntime } = await setup(t)
  assert.equal((await request('/api/health')).status, 200)
  failRuntime()
  const response = await request('/api/health')
  assert.equal(response.status, 503)
  assert.equal((await response.json() as any).error.code, 'TASK_RUNTIME_UNAVAILABLE')
})

test('rerun API forwards an explicit step boundary', async t => {
  const { request, reruns } = await setup(t)
  const id = randomUUID(), next = randomUUID()
  const response = await request(`/api/v2/tasks/${id}/rerun`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: next, config: {}, fromStep: 'reference' }) })
  assert.equal(response.status, 201)
  assert.equal((await response.json() as any).id, next)
  assert.equal(reruns[0].id, id)
  assert.equal(reruns[0].request.fromStep, 'reference')
})

test('multipart accepts named inputs and rejects duplicate slots before creating a task', async t => {
  const { created, post, form } = await setup(t)
  const valid = form(); valid.append('input.document', new Blob(['hello']), 'hello.txt')
  assert.equal((await post(valid)).status, 201)
  assert.equal(Object.keys(created[0].inputs).join(), 'document')
  assert.equal(Object.values(created[0].artifacts).length, 1)
  const duplicate = form()
  duplicate.append('input.document', new Blob(['one']), 'one.txt')
  duplicate.append('input.document', new Blob(['two']), 'two.md')
  const rejected = await post(duplicate)
  assert.equal(rejected.status, 422)
  assert.equal((await rejected.json() as any).error.code, 'INVALID_INPUT')
  assert.equal(created.length, 1)
})

test('metadata-only multipart reserves a fresh task directory like JSON requests', async t => {
  const { ctx, created, post, form } = await setup(t)
  const data = form(), id = JSON.parse(data.get('request') as string).id
  const response = await post(data)
  assert.equal(response.status, 201, await response.text())
  await ctx.files.log(id, 'Task validation failed before the first invocation')
  assert.match(await ctx.files.readLog(id), /Task validation failed/)
  const repeated = await post(data)
  assert.equal(repeated.status, 409)
  assert.equal((await repeated.json() as any).error.code, 'IMPORT_RESIDUE')
  assert.equal(created.length, 1)
})

test('multipart preserves Chinese filenames and spaces across the API boundary', async t => {
  const { created, post, form } = await setup(t)
  const data = form(), filename = '真实语音 JFK.txt'
  data.append('input.document', new Blob(['中文内容']), filename)
  const response = await post(data)
  assert.equal(response.status, 201, await response.text())
  assert.equal(created[0].sourceName, filename)
  assert.equal((Object.values(created[0].artifacts)[0] as any).name, filename)
})

test('malformed uploads fail promptly without creating a task', async t => {
  const { created, post } = await setup(t)
  const malformed = await post('broken', { 'Content-Type': 'multipart/form-data' })
  assert.equal(malformed.status, 400)
  const metadata = JSON.stringify({ id: randomUUID(), workflowId: 'test.upload', config: {} })
  const truncated = await post(`--test\r\nContent-Disposition: form-data; name="request"\r\n\r\n${metadata}\r\n--test\r\nContent-Disposition: form-data; name="input.document"; filename="test.txt"\r\n\r\npartial`, { 'Content-Type': 'multipart/form-data; boundary=test' })
  assert.equal(truncated.status, 400)
  assert.equal(created.length, 0)
})

test('multipart accepts URL metadata without a file and preserves the source name', async t => {
  const { created, post } = await setup(t)
  const data = new FormData(), source = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
  data.append('request', JSON.stringify({ id: randomUUID(), workflowId: 'test.download', sourceName: source, config: { source_url: source } }))
  const response = await post(data)
  assert.equal(response.status, 201, await response.text())
  assert.equal(created[0].sourceName, source)
  assert.deepEqual(created[0].inputs, {})
  assert.equal(created[0].config.source_url, source)
})

test('workflow reads never run migrations and remain available after an explicit migration failure', async t => {
  const { ctx, request } = await setup(t)
  await nextTurn()
  const calls: string[] = []
  ctx.store.call = async (method: string) => {
    calls.push(method)
    if (method === 'settings.raw') return { defaults: { source_language: 'auto' } } as any
    if (method === 'store.workflow_list') return { items: [], total: 0 } as any
    if (method === 'settings.validate_defaults') throw new AppError('SQLITE_ERROR', 'disk full during migration', 500)
    throw new Error(`Unexpected call: ${method}`)
  }
  const url = '/api/v2/workflow-documents'
  assert.equal((await request(url)).status, 200)
  assert.equal((await request(url + '/youdub.subtitles')).status, 200)
  assert.ok(calls.every(method => ['settings.raw', 'store.workflow_list'].includes(method)))
  const failed = await request(url + '/migrate-defaults', { method: 'POST' })
  assert.equal(failed.status, 500)
  assert.equal((await failed.json() as any).error.code, 'SQLITE_ERROR')
  const readable = await request(url)
  assert.equal(readable.status, 200)
  const body = await readable.json() as any
  assert.equal(body.legacyDefaultsMigration.status, 'blocked')
  assert.equal(body.legacyDefaultsMigration.diagnostics[0].code, 'SQLITE_ERROR')
  assert.match(body.legacyDefaultsMigration.diagnostics[0].message, /disk full/)
  assert.equal(body.items.length, 3)
})
