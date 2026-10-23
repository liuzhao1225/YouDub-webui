// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryResource, taskNeedsPolling } from './query'
import type { Request } from './types'

afterEach(() => vi.useRealTimers())

it('stops polling terminal tasks while still allowing an explicit refresh', async () => {
  vi.useFakeTimers()
  const load = vi.fn().mockResolvedValueOnce({ status: 'running' }).mockResolvedValue({ status: 'succeeded' })
  const resource = new QueryResource(load, 100, taskNeedsPolling)
  const stop = resource.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(1000)
  expect(load).toHaveBeenCalledTimes(2)
  resource.refresh()
  await vi.advanceTimersByTimeAsync(1000)
  expect(load).toHaveBeenCalledTimes(3)
  stop()
})

it('keeps the last result and exposes a polling failure until the user refreshes', async () => {
  vi.useFakeTimers()
  const load = vi.fn().mockResolvedValueOnce({ name: 'first' }).mockRejectedValueOnce(new Error('Polling unavailable')).mockResolvedValueOnce({ name: 'recovered' })
  const resource = new QueryResource<{ name: string }>(load, 100)
  const stop = resource.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(resource.getSnapshot()).toEqual({ data: { name: 'first' }, error: '' })
  await vi.advanceTimersByTimeAsync(100)
  expect(resource.getSnapshot()).toEqual({ data: { name: 'first' }, error: 'Polling unavailable' })
  await vi.advanceTimersByTimeAsync(1000)
  expect(load).toHaveBeenCalledTimes(2)
  resource.refresh()
  await vi.advanceTimersByTimeAsync(0)
  expect(resource.getSnapshot()).toEqual({ data: { name: 'recovered' }, error: '' })
  stop()
  await vi.advanceTimersByTimeAsync(1000)
  expect(load).toHaveBeenCalledTimes(3)
})

it('aborts when its last subscriber leaves and ignores a late transport completion', async () => {
  let complete!: (value: string) => void
  let signal!: AbortSignal
  const resource = new QueryResource<string>((nextSignal) => { signal = nextSignal; return new Promise((resolve) => { complete = resolve }) })
  const first = resource.subscribe(() => {}), second = resource.subscribe(() => {})
  first()
  expect(signal.aborted).toBe(false)
  second()
  expect(signal.aborted).toBe(true)
  complete('late result')
  await Promise.resolve()
  expect(resource.getSnapshot()).toEqual({ data: null, error: '' })
})

it('loads all workflow pages and reports a later-page failure without publishing a partial list', async () => {
  const request = vi.fn().mockResolvedValueOnce({ items: [{ id: 'first' }], hasMore: true, limit: 1 }).mockRejectedValueOnce(new Error('Second page failed'))
  const resource = new QueryClient(request as Request).workflowDocuments()
  const failed = new Promise<void>((resolve) => resource.subscribe(() => { if (resource.getSnapshot().error) resolve() }))
  await failed
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/v2/workflow-documents?limit=100&offset=0', '/api/v2/workflow-documents?limit=100&offset=1'])
  expect(resource.getSnapshot()).toEqual({ data: null, error: 'Second page failed' })
})
