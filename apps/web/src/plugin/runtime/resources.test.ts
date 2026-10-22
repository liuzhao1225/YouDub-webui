import { afterEach, expect, it, vi } from 'vitest'
import { ResourcesController, WorkflowResourceChecks, changesResources } from './workflow-resources'
import type { WorkflowDocument } from '../contracts'
import type { ResourceInventory, ResourcePreparation } from '@/runtime/setup-contracts'

const inspection: ResourcePreparation = { status: 'missing', selections: [{ providerId: 'whisper', model: 'tiny' }],
  requirements: [{ providerId: 'whisper', model: 'tiny', ready: false, automatic: true, missingPackages: [] }], environment: [], models: [] }
const inventory: ResourceInventory = { version: '0.0.7', platform: 'darwin', arch: 'arm64', osVersion: '25', homeDir: '/home/example', environment: [],
  items: [{ providerId: 'whisper', model: 'tiny', label: 'Whisper', automatic: true, downloadId: 'whisper' }], models: [] }
afterEach(() => vi.useRealTimers())

function document(id = 'one'): WorkflowDocument {
  return { format: 'youdub.workflow', formatVersion: 1, id, title: id, nodes: [{ id: 'node', type: 'recognize', typeVersion: '1', provider: { id: 'whisper', model: 'tiny' }, config: { language: 'zh' }, autoContinue: true }], edges: [], inputs: [], outputs: [], presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } } }
}
it('reuses a dependency check across routes, node duplicates and config changes, then invalidates explicitly', async () => {
  const request = vi.fn().mockResolvedValue({ status: 'ready', requirements: [] })
  const checks = new WorkflowResourceChecks(request)
  const first = checks.get(document()), stop = first.subscribe(() => {})
  await vi.waitFor(() => expect(first.getSnapshot().checking).toBe(false))
  stop()
  const other = document('another'); other.nodes.push({ ...other.nodes[0], id: 'duplicate', config: { language: 'en' } })
  const second = checks.get(other)
  expect(second).toBe(first)
  const stopAgain = second.subscribe(() => {})
  expect(request).toHaveBeenCalledTimes(1)
  checks.invalidate()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(second.getSnapshot().checking).toBe(false))
  second.check()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))
  stopAgain(); checks.clear()
  expect(checks.get(document()).getSnapshot().result).toBeUndefined()
})
it('retains a failed check on remount and does not silently retry it', async () => {
  const request = vi.fn().mockRejectedValue(new Error('Resource check failed'))
  const checks = new WorkflowResourceChecks(request), resource = checks.get(document())
  const stop = resource.subscribe(() => {})
  await vi.waitFor(() => expect(resource.getSnapshot().error).toBe('Resource check failed'))
  stop()
  const stopAgain = checks.get(document()).subscribe(() => {})
  expect(request).toHaveBeenCalledTimes(1)
  expect(resource.getSnapshot().error).toBe('Resource check failed')
  resource.check()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  stopAgain()
})
it('isolates a node type version failure from a valid graph using the same model', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('NODE_TYPE_UNAVAILABLE')).mockResolvedValueOnce({ status: 'ready', requirements: [] })
  const checks = new WorkflowResourceChecks(request), old = document()
  old.nodes[0].typeVersion = 'removed'
  const invalid = checks.get(old), stop = invalid.subscribe(() => {})
  await vi.waitFor(() => expect(invalid.getSnapshot().error).toBe('NODE_TYPE_UNAVAILABLE'))
  stop()
  const valid = checks.get(document()), stopValid = valid.subscribe(() => {})
  expect(valid).not.toBe(invalid)
  await vi.waitFor(() => expect(valid.getSnapshot().result?.status).toBe('ready'))
  expect(valid.getSnapshot().error).toBeUndefined()
  expect(invalid.getSnapshot().error).toBe('NODE_TYPE_UNAVAILABLE')
  stopValid()
})
it('keeps a failed progress poll visible when returning to a preparing workflow', async () => {
  vi.useFakeTimers()
  const request = vi.fn().mockResolvedValueOnce({ status: 'preparing' }).mockRejectedValue(new Error('Progress read failed'))
  const resource = new WorkflowResourceChecks(request).get(document())
  const stop = resource.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(1200)
  expect(resource.getSnapshot().error).toBe('Progress read failed')
  stop()
  const stopAgain = resource.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(3000)
  expect(request).toHaveBeenCalledTimes(2)
  expect(resource.getSnapshot().error).toBe('Progress read failed')
  stopAgain()
})
it('does not abort its own preparation on mutation invalidation and continues progress polling', async () => {
  vi.useFakeTimers()
  const checks = new WorkflowResourceChecks(request)
  const signals: AbortSignal[] = []
  let prepared = false
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    if (path.endsWith('/prepare')) { signals.push(init!.signal!); checks.invalidate(); prepared = true; return { status: 'preparing' } as T }
    return { status: prepared ? 'ready' : 'missing' } as T
  }
  const resource = checks.get(document()), stop = resource.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(0)
  resource.prepare()
  await vi.advanceTimersByTimeAsync(0)
  expect(signals[0].aborted).toBe(false)
  expect(resource.getSnapshot().result?.status).toBe('preparing')
  await vi.advanceTimersByTimeAsync(1200)
  expect(resource.getSnapshot().result?.status).toBe('ready')
  stop()
})
it('invalidates resource changes while leaving language settings and task mutations alone', () => {
  expect(changesResources('/api/v2/settings', 'PATCH', JSON.stringify({ ui_language: 'zh' }))).toBe(false)
  expect(changesResources('/api/v2/settings', 'PATCH', JSON.stringify({ connection: { model: 'new' } }))).toBe(true)
  expect(changesResources('/api/v2/resources/check', 'POST', '{}')).toBe(false)
  expect(changesResources('/api/v2/resources/prepare', 'POST', '{}')).toBe(true)
  expect(changesResources('/api/v2/extensions/example', 'DELETE')).toBe(true)
  expect(changesResources('/api/v2/tasks', 'POST', new FormData())).toBe(false)
  expect(changesResources('/api/v2/models/settings', 'PATCH')).toBe(true)
  expect(changesResources('/api/v2/models/credentials/EXAMPLE_KEY', 'PUT')).toBe(true)
  expect(changesResources('/api/v2/models/credentials/EXAMPLE_KEY', 'DELETE')).toBe(true)
  expect(changesResources('/api/v2/models/credentials/describe', 'POST')).toBe(false)
  expect(changesResources('/api/v2/models/discover', 'POST')).toBe(false)
})

it('checks selections on mount without preparing, prepares only the selected resource and stops reads on disposal', async () => {
  vi.useFakeTimers()
  let current = inventory
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/prepare')) { current = { ...inventory, resources: { ...inspection, status: 'preparing' } }; return current.resources }
    if (path.endsWith('/check')) return inspection
    return current
  })
  const controller = new ResourcesController(request as never)
  const unsubscribe = controller.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(0)
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/v2/resources', '/api/v2/resources/check'])
  const selections = [{ providerId: 'whisper', model: 'tiny' }]
  controller.prepare(selections)
  await vi.advanceTimersByTimeAsync(0)
  expect((request.mock.calls as unknown as [string, RequestInit][]).find(([path]) => path.endsWith('/prepare'))?.[1].body).toBe(JSON.stringify({ selections }))
  expect(controller.getSnapshot().inventory?.resources?.status).toBe('preparing')
  await vi.advanceTimersByTimeAsync(1200)
  const count = request.mock.calls.length
  unsubscribe()
  await vi.advanceTimersByTimeAsync(5000)
  expect(request).toHaveBeenCalledTimes(count)
  expect(request.mock.calls.some(([path]) => path.endsWith('/action'))).toBe(false)
})

it('does not follow a mutation with more requests after its view has closed', async () => {
  let finish!: (value: unknown) => void
  const request = vi.fn().mockResolvedValueOnce(inventory).mockResolvedValueOnce(inspection)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const controller = new ResourcesController(request)
  const unsubscribe = controller.subscribe(() => {})
  await vi.waitFor(() => expect(controller.getSnapshot().checking).toBe(false))
  controller.action('pause', 'whisper')
  unsubscribe()
  finish(inventory)
  await Promise.resolve(); await Promise.resolve()
  expect(request).toHaveBeenCalledTimes(3)
  expect(request.mock.calls[2][1].signal.aborted).toBe(true)
})

it('keeps a resource failure visible without background retries', async () => {
  vi.useFakeTimers()
  const request = vi.fn().mockRejectedValue(new Error('resource service unavailable'))
  const controller = new ResourcesController(request)
  const unsubscribe = controller.subscribe(() => {})
  await vi.advanceTimersByTimeAsync(5000)
  expect(controller.getSnapshot().error).toBe('resource service unavailable')
  expect(request).toHaveBeenCalledTimes(1)
  unsubscribe()
})

it('clears stale availability when a later inventory inspection fails', async () => {
  const request = vi.fn().mockResolvedValueOnce(inventory).mockResolvedValueOnce({ ...inspection, status: 'ready' })
    .mockResolvedValueOnce(inventory).mockRejectedValueOnce(new Error('inspection failed'))
  const controller = new ResourcesController(request)
  const unsubscribe = controller.subscribe(() => {})
  await vi.waitFor(() => expect(controller.getSnapshot().inspection?.status).toBe('ready'))
  controller.check()
  await vi.waitFor(() => expect(controller.getSnapshot().error).toBe('inspection failed'))
  expect(controller.getSnapshot().inspection).toBeUndefined()
  unsubscribe()
})
