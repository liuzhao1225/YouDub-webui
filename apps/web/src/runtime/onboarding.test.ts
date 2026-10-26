import { afterEach, expect, it, vi } from 'vitest'
import { SetupController, TranslationSetupController } from './onboarding'

const setup = { phase: 'models', platform: 'darwin', arch: 'arm64', canRetry: true, environment: [], models: [] }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('stops setup polling at readiness and aborts owned requests on disposal', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValueOnce(setup).mockResolvedValue({ ...setup, phase: 'ready' })
  const controller = new SetupController(fetch as never)
  controller.start()
  await vi.advanceTimersByTimeAsync(800)
  expect(controller.getSnapshot().state?.phase).toBe('ready')
  expect(fetch).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(2400)
  expect(fetch).toHaveBeenCalledTimes(2)
  controller.stop()
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
})

it('does not let an abandoned setup request overwrite a reconnected session', async () => {
  let finish!: (value: unknown) => void
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValue({ ...setup, phase: 'ready' })
  const controller = new SetupController(fetch as never)
  controller.start()
  controller.start()
  await vi.waitFor(() => expect(controller.getSnapshot().state?.phase).toBe('ready'))
  finish({ ...setup, phase: 'failed' })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().state?.phase).toBe('ready')
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  controller.stop()
})

it('keeps setup failures visible until an explicit reconnect', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockRejectedValueOnce(new Error('service offline')).mockResolvedValue({ ...setup, phase: 'ready' })
  const controller = new SetupController(fetch as never)
  controller.start()
  await vi.advanceTimersByTimeAsync(3000)
  expect(controller.getSnapshot().error).toBe('service offline')
  expect(fetch).toHaveBeenCalledTimes(1)
  controller.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(controller.getSnapshot()).toMatchObject({ error: '', state: { phase: 'ready' } })
  controller.stop()
})

it('does not restore a stale model selection after preparing the selected models', async () => {
  vi.useFakeTimers()
  const choosing = { ...setup, resourceSelection: { required: true, selections: [{ providerId: 'whisper', model: 'tiny' }], items: [], prepared: false } }
  const preparing = { ...choosing, resourceSelection: { ...choosing.resourceSelection, required: false } }
  let finishPoll!: (state: unknown) => void
  const request = vi.fn().mockResolvedValueOnce(choosing)
    .mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve }))
    .mockResolvedValueOnce(preparing)
    .mockResolvedValue({ ...preparing, phase: 'ready' })
  const controller = new SetupController(request as never)
  controller.start()
  await vi.advanceTimersByTimeAsync(800)
  await controller.prepare(choosing.resourceSelection.selections)
  expect(controller.getSnapshot().state?.resourceSelection?.required).toBe(false)
  finishPoll(choosing)
  await vi.advanceTimersByTimeAsync(0)
  expect(controller.getSnapshot().state?.resourceSelection?.required).toBe(false)
  await vi.advanceTimersByTimeAsync(800)
  expect(controller.getSnapshot().state?.phase).toBe('ready')
  await vi.advanceTimersByTimeAsync(1600)
  expect(request).toHaveBeenCalledTimes(4)
  controller.stop()
})

it('aborts first-run provider requests when the setup view closes', async () => {
  let finish!: (value: unknown) => void
  const fetch = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/v2/settings') return Promise.resolve({})
    return new Promise(resolve => { finish = resolve })
  })
  const controller = new TranslationSetupController(fetch as never)
  controller.start()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  controller.stop()
  expect(fetch.mock.calls[1][1].signal.aborted).toBe(true)
  finish({ providers: [{ capability: 'translation', available: true }] })
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().ready).toBe(false)
  await expect(controller.request('/api/v2/models/settings')).rejects.toThrow('closed')
})

it('uses the injected Harness transport and waits for Continue after a provider becomes usable', async () => {
  let providers: unknown[] = []
  const request = vi.fn(async (path: string) => path === '/api/v2/catalog' ? { providers } : {})
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const controller = new TranslationSetupController(request as never)
  controller.start()
  await vi.waitFor(() => expect(controller.getSnapshot().loaded).toBe(true))
  expect(controller.getSnapshot()).toMatchObject({ configured: false, ready: false })
  providers = [{ id: 'llm.example', capability: 'translation', available: true }]
  await controller.refreshConfigured()
  expect(controller.getSnapshot()).toMatchObject({ configured: true, ready: false })
  expect(fetch).not.toHaveBeenCalled()
  expect(request.mock.calls.every(([path]) => path !== '/api/auth/session')).toBe(true)
  controller.continue()
  expect(controller.getSnapshot().ready).toBe(true)
  controller.stop()
})

it('persists Configure later through the injected transport and restores it on the next start', async () => {
  let deferred = false
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return { providers: [] }
    if (init?.method === 'PATCH') deferred = JSON.parse(init.body as string).plugin.config.translationDeferred
    return { plugins: { 'youdub.onboarding': { translationDeferred: deferred } } }
  })
  const controller = new TranslationSetupController(request as never)
  controller.start()
  await vi.waitFor(() => expect(controller.getSnapshot().loaded).toBe(true))
  await controller.skip()
  expect(controller.getSnapshot().ready).toBe(true)
  controller.start()
  await vi.waitFor(() => expect(controller.getSnapshot().ready).toBe(true))
  expect(controller.getSnapshot().configured).toBe(false)
  controller.stop()
})

it('explains an unavailable translation provider and clears the reason after repair', async () => {
  const provider = { id: 'llm.example', label: 'Example', capability: 'translation', available: false, unavailableReason: '模型输出容量不足。' }
  const request = vi.fn(async (path: string) => path === '/api/v2/catalog' ? { providers: [
    { ...provider, id: 'openai', legacy: true, unavailableReason: 'legacy provider' }, provider,
  ] } : {})
  const controller = new TranslationSetupController(request as never)
  controller.start()
  await vi.waitFor(() => expect(controller.getSnapshot().loaded).toBe(true))
  expect(controller.getSnapshot()).toMatchObject({ configured: false, ready: false, error: 'Example: 模型输出容量不足。' })
  controller.continue()
  expect(controller.getSnapshot().ready).toBe(false)
  provider.available = true
  await controller.refreshConfigured()
  expect(controller.getSnapshot()).toMatchObject({ configured: true, ready: false, error: '' })
  controller.continue()
  expect(controller.getSnapshot().ready).toBe(true)
  controller.stop()
})
