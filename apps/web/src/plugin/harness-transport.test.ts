import { afterEach, expect, it, vi } from 'vitest'
import { requestHarness } from '../../../harness/src/frontend/runtime'

afterEach(() => vi.unstubAllGlobals())
it('uses the product RPC envelope and sends uploads through its dedicated authenticated endpoint', async () => {
  const fetch = vi.fn(async () => Response.json({ saved: true }))
  vi.stubGlobal('fetch', fetch)
  const signal = new AbortController().signal
  await requestHarness('/api/v2/settings', { method: 'PATCH', body: JSON.stringify({ ui_language: 'zh' }), signal })
  expect(fetch).toHaveBeenCalledWith('/api/youdub/v2', expect.objectContaining({ method: 'POST', credentials: 'include', signal, body: JSON.stringify({ method: 'PATCH', path: '/api/v2/settings', body: { ui_language: 'zh' } }) }))
  const body = new FormData(); body.set('request', '{}')
  await requestHarness('/api/v2/tasks', { method: 'POST', body })
  expect(fetch).toHaveBeenLastCalledWith('/api/youdub/upload', expect.objectContaining({ body, credentials: 'include', headers: undefined }))
  await expect(requestHarness('https://external.invalid')).rejects.toThrow('Unsupported YouDub API path')
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('preserves streamed authorization errors and propagates request cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_path: string, init: RequestInit) => {
    const signal = init.signal!
    const stream = new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true })
      setTimeout(() => {
        if (signal.aborted) return
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: 'Session expired' } })))
        controller.close()
      }, 10)
    } })
    return new Response(stream, { status: 401, headers: { 'Content-Type': 'application/json' } })
  }))
  const controller = new AbortController()
  await expect(requestHarness('/api/v2/tasks', { signal: controller.signal })).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED', message: 'Session expired' })
  const cancelled = new AbortController()
  const pending = requestHarness('/api/v2/tasks', { signal: cancelled.signal })
  cancelled.abort(new Error('Cancelled by user'))
  await expect(pending).rejects.toThrow('Cancelled by user')
})
