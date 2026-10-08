import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Http from '../src/http.js'
import Auth from '../src/auth.js'

test('HTTP ranges, HEAD, invalid ranges, and Cordis route disposal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youdub-http-'))
  const file = join(directory, 'test.txt'); await writeFile(file, '0123456789')
  const ctx = new Context()
  const http = await ctx.plugin(Http, { host: '127.0.0.1', port: 0 })
  t.after(async () => { await http.dispose(); await rm(directory, { recursive: true }) })
  const routes = await ctx.plugin({ inject: ['http'], apply(context) {
    context.effect(() => context.http.register('GET', '/file', request => context.http.file(request, file, { mime: 'text/plain' })))
  } })
  const url = ctx.http.address + '/file'
  ctx.emit('app/ready')
  const slice = await fetch(url, { headers: { Range: 'bytes=2-5' } })
  assert.equal(slice.status, 206); assert.equal(slice.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await slice.text(), '2345')
  const suffix = await fetch(url, { headers: { Range: 'bytes=-3' } }); assert.equal(await suffix.text(), '789')
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '')
  const invalid = await fetch(url, { headers: { Range: 'bytes=20-30' } }); assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */10')
  await routes.dispose()
  assert.equal((await fetch(url)).status, 404)
})

test('auth preserves cookie path, CSRF, login replacement and logout', async t => {
  const ctx = new Context(), sessions = new Map<string, any>()
  const service = await ctx.plugin(function store(context) {
    context.reflect.provide('store', { async call(method: string, params: any) {
      if (method === 'auth.validate') return { cookieName: 'test_session', sessionTtlSeconds: 300, cookieSecure: false, cookieSameSite: 'lax', credentialVersion: 'v1' }
      if (method === 'auth.reserve_login_attempt') return { allowed: true, window_started_at: params.now }
      if (method === 'auth.verify_password') return { valid: params.password === 'test-password' }
      if (method === 'auth.get_session') return sessions.get(params.token_hash)
      if (method === 'auth.create_session') { sessions.set(params.token_hash, params); return null }
      if (method === 'auth.delete_session') return sessions.delete(params.token_hash)
      if (method === 'auth.delete_expired_sessions' || method === 'auth.delete_login_attempt') return null
      throw new Error(`Unexpected storage method: ${method}`)
    } })
  })
  const http = await ctx.plugin(Http, { host: '127.0.0.1', port: 0 })
  const auth = await ctx.plugin(Auth)
  t.after(async () => { await auth.dispose(); await http.dispose(); await service.dispose() })
  const url = ctx.http.address!
  ctx.emit('app/ready')
  const login = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')!
  assert.match(cookie, /Path=\/api/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=lax/)
  const token = cookie.split(';')[0]!, result = await login.json() as any
  assert.equal(sessions.size, 1)
  const session = await fetch(url + '/api/auth/session', { headers: { Cookie: token } })
  assert.equal(session.status, 200); assert.equal((await session.json() as any).csrf_token, result.csrf_token)
  assert.equal((await fetch(url + '/api/auth/logout', { method: 'POST', headers: { Cookie: token } })).status, 403)
  const logout = await fetch(url + '/api/auth/logout', { method: 'POST', headers: { Cookie: token, 'X-CSRF-Token': result.csrf_token } })
  assert.equal(logout.status, 204); assert.equal(sessions.size, 0)
  assert.equal((await fetch(url + '/api/auth/session', { headers: { Cookie: token } })).status, 401)
})

test('HTTP rejects traffic before readiness and drains in-flight handlers before plugin disposal', async t => {
  const ctx = new Context()
  let release!: () => void, entered!: () => void, stopped = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { entered = resolve })
  const application = await ctx.plugin(async function application(context) {
    await context.plugin(Http, { host: '127.0.0.1', port: 0 })
    await context.plugin({ inject: ['http'], apply(scope) {
      scope.effect(() => scope.http.register('GET', '/slow', async request => {
        entered(); await gate
        scope.http.json(request, 200, { state: 'finished' })
      }))
    } })
  })
  t.after(() => application.dispose())
  const url = ctx.http.address + '/slow'
  assert.equal((await fetch(url)).status, 503)
  ctx.emit('app/ready')
  const request = fetch(url)
  await started
  const stop = ctx.parallel('app/stopping').then(() => application.dispose()).then(() => { stopped = true })
  await delay(20)
  assert.equal(stopped, false)
  release()
  const response = await request
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { state: 'finished' })
  await stop
})
