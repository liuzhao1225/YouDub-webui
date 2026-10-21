import { afterEach, expect, it, vi } from 'vitest'
import { SetupController, TranslationSetupController } from './onboarding'

const setup = { phase: 'models', platform: 'darwin', arch: 'arm64', token: 'setup-token', canRetry: true, environment: [], models: [] }
const setupResponse = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) })
const response = (body: unknown) => Response.json(body)
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('stops setup polling at readiness and aborts owned requests on disposal', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockResolvedValueOnce(setupResponse(setup)).mockResolvedValue(setupResponse({ ...setup, phase: 'ready' }))
  vi.stubGlobal('fetch', fetch)
  const controller = new SetupController()
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
    .mockResolvedValue(setupResponse({ ...setup, phase: 'ready' }))
  vi.stubGlobal('fetch', fetch)
  const controller = new SetupController()
  controller.start()
  controller.start()
  await vi.waitFor(() => expect(controller.getSnapshot().state?.phase).toBe('ready'))
  finish(setupResponse({ ...setup, phase: 'failed' }))
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().state?.phase).toBe('ready')
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
  controller.stop()
})

it('keeps setup failures visible until an explicit reconnect', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn().mockRejectedValueOnce(new Error('service offline')).mockResolvedValue(setupResponse({ ...setup, phase: 'ready' }))
  vi.stubGlobal('fetch', fetch)
  const controller = new SetupController()
  controller.start()
  await vi.advanceTimersByTimeAsync(3000)
  expect(controller.getSnapshot().error).toBe('service offline')
  expect(fetch).toHaveBeenCalledTimes(1)
  controller.start()
  await vi.advanceTimersByTimeAsync(0)
  expect(controller.getSnapshot()).toMatchObject({ error: '', state: { phase: 'ready' } })
  controller.stop()
})

it('aborts first-run provider requests when the setup view closes', async () => {
  let finish!: (value: Response) => void
  const fetch = vi.fn().mockImplementation((path: string) => {
    if (path === '/api/auth/session') return Promise.resolve(response({ csrf_token: 'csrf' }))
    if (path === '/api/v2/settings') return Promise.resolve(response({}))
    return new Promise(resolve => { finish = resolve })
  })
  vi.stubGlobal('fetch', fetch)
  const controller = new TranslationSetupController()
  controller.start()
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  controller.stop()
  expect(fetch.mock.calls[2][1].signal.aborted).toBe(true)
  finish(response({ providers: [{ capability: 'translation', available: true }] }))
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  expect(controller.getSnapshot().ready).toBe(false)
  await expect(controller.request('/api/v2/models/settings')).rejects.toThrow('closed')
})
