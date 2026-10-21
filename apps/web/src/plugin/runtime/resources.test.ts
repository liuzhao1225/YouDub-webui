import { afterEach, expect, it, vi } from 'vitest'
import { ResourcesController } from './workflow-resources'
import type { ResourceInventory, ResourcePreparation } from '@/runtime/setup-contracts'

const inspection: ResourcePreparation = { status: 'missing', selections: [{ providerId: 'whisper', model: 'tiny' }],
  requirements: [{ providerId: 'whisper', model: 'tiny', ready: false, automatic: true, missingPackages: [] }], environment: [], models: [] }
const inventory: ResourceInventory = { version: '0.0.7', platform: 'darwin', arch: 'arm64', osVersion: '25', homeDir: '/home/example', environment: [],
  items: [{ providerId: 'whisper', model: 'tiny', label: 'Whisper', automatic: true, downloadId: 'whisper' }], models: [] }
afterEach(() => vi.useRealTimers())

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
