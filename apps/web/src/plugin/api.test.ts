import { afterEach, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import { ApiService } from './builtin/api'

afterEach(() => vi.unstubAllGlobals())

it('emits mutation events only for successful writes and clears session-owned state explicitly', async () => {
  const ctx = new Context(), api = new ApiService(ctx), mutations: unknown[][] = []
  let cleared = 0
  ctx.on('client/mutated', (...args) => { mutations.push(args) })
  ctx.on('client/session-cleared', () => { cleared++ })
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ready: true }))
    .mockResolvedValueOnce(Response.json({ saved: true }))
    .mockResolvedValueOnce(Response.json({ error: { code: 'INVALID_CONFIG', message: 'Invalid model' } }, { status: 422 }))
  vi.stubGlobal('fetch', fetch)
  api.setCsrf('test-csrf')
  await api.request('/api/v2/resources')
  const body = JSON.stringify({ connection: { adapter: 'openai', model: 'test' } })
  await api.request('/api/v2/settings', { method: 'PATCH', body })
  await expect(api.request('/api/v2/settings', { method: 'PATCH', body })).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  expect(mutations).toEqual([['/api/v2/settings', 'PATCH', body]])
  expect(new Headers(fetch.mock.calls[1][1].headers).get('X-CSRF-Token')).toBe('test-csrf')
  api.clearSession()
  expect(cleared).toBe(1)
})

it('reads a streamed unauthorized error before session expiry aborts pending reads', async () => {
  const ctx = new Context(), api = new ApiService(ctx)
  let expired = 0
  ctx.on('client/unauthorized', () => { expired++; api.clearSession() })
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init: RequestInit) => {
    const signal = init.signal!
    const stream = new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
      setTimeout(() => {
        if (signal.aborted) return
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } })))
        controller.close()
      }, 10)
    } })
    return new Response(stream, { status: 401, headers: { 'Content-Type': 'application/json' } })
  }))
  await expect(api.request('/api/v2/tasks')).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED', message: 'Session expired' })
  expect(expired).toBe(1)
})
