import { expect, it, vi } from 'vitest'
import { ConnectionController } from './connection'

const connection = { adapter: 'openai', base_url: 'https://example.test/v1', model: 'old-model', has_api_key: true, api_key_hint: 'sk-abc****' }
const settings = { connections: [connection] }

it('tracks normalized edits and explicit key clearing; testing does not save the draft', async () => {
  const request = vi.fn().mockResolvedValueOnce(settings).mockResolvedValue({ ok: true })
  const controller = new ConnectionController(request)
  await controller.start()
  expect(controller.getSnapshot()).toMatchObject({ dirty: false, savedKey: true, key: '' })
  controller.change({ url: ` ${connection.base_url} ` })
  expect(controller.getSnapshot().dirty).toBe(false)
  controller.change({ model: 'new-model' })
  expect(controller.getSnapshot().dirty).toBe(true)
  expect(await controller.test()).toBe(true)
  expect(controller.getSnapshot()).toMatchObject({ dirty: true, saved: false })
  expect(controller.getSnapshot().testedAt).toBeTruthy()
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  controller.change({ model: 'old-model' })
  expect(controller.getSnapshot()).toMatchObject({ dirty: false, testedAt: null })
  controller.change({ clearKey: true })
  expect(controller.getSnapshot()).toMatchObject({ dirty: true, savedKey: false })
  controller.change({ clearKey: false })
  expect(controller.getSnapshot()).toMatchObject({ dirty: false, savedKey: true })
  controller.stop()
})

it('never reuses the old address key or its visible hint for a different address', async () => {
  const request = vi.fn().mockResolvedValue(settings)
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ url: 'https://other.test/v1' })
  expect(await controller.test()).toBe(false)
  expect(await controller.save()).toBe(false)
  expect(controller.getSnapshot()).toMatchObject({ savedKey: false, validation: 'key', dirty: true })
  expect(request).toHaveBeenCalledTimes(1)
  controller.change({ key: 'new-secret' })
  await controller.test()
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ base_url: 'https://other.test/v1', model: 'old-model', api_key: 'new-secret' })
  controller.stop()
})

it('saves model and connection in one patch, then reads the actual saved state and clears plaintext', async () => {
  const saved = { connections: [{ ...connection, model: 'new-model', api_key_hint: 'new-ke****' }] }
  const request = vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(saved).mockResolvedValueOnce(saved)
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ model: ' new-model ', key: ' new-key ' })
  expect(await controller.save()).toBe(true)
  expect(request.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([
    ['/api/v2/settings', 'GET'], ['/api/v2/settings', 'PATCH'], ['/api/v2/settings', 'GET'],
  ])
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ connection: { adapter: 'openai', base_url: connection.base_url, model: 'new-model', api_key: 'new-key' } })
  expect(controller.getSnapshot()).toMatchObject({ model: 'new-model', key: '', dirty: false, saved: true, savedKey: true })
  controller.stop()
})

it('clears a stored key only with an explicit null patch', async () => {
  const saved = { connections: [{ ...connection, has_api_key: false, api_key_hint: null }] }
  const request = vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(saved).mockResolvedValueOnce(saved)
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ clearKey: true })
  expect(await controller.save()).toBe(true)
  expect(JSON.parse(request.mock.calls[1][1].body).connection).toEqual({ adapter: 'openai', base_url: connection.base_url, model: connection.model, api_key: null })
  expect(controller.getSnapshot()).toMatchObject({ savedKey: false, clearKey: false, dirty: false })
  controller.stop()
})

it('keeps original errors visible and does not write after a failed connection test', async () => {
  const request = vi.fn().mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error('HTTP 404: model endpoint is missing'))
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ model: 'missing' })
  expect(await controller.test()).toBe(false)
  expect(controller.getSnapshot()).toMatchObject({ error: 'HTTP 404: model endpoint is missing', dirty: true, testedAt: null, busy: false })
  expect(request).toHaveBeenCalledTimes(2)
  controller.stop()
})

it('can clear a legacy connection key before a model was registered', async () => {
  const legacy = { connections: [{ ...connection, model: undefined }] }
  const request = vi.fn().mockResolvedValueOnce(legacy).mockResolvedValue({ connections: [{ ...connection, model: undefined, has_api_key: false }] })
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ clearKey: true })
  expect(await controller.save()).toBe(true)
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ connection: { adapter: 'openai', base_url: connection.base_url, api_key: null } })
  controller.stop()
})

it('does not claim save success when its readback fails', async () => {
  const request = vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error('readback unavailable'))
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ key: 'new-secret' })
  expect(await controller.save()).toBe(false)
  expect(controller.getSnapshot()).toMatchObject({ key: '', dirty: true, saved: false, readbackFailed: true, error: 'readback unavailable' })
  controller.stop()
})

it('reads a reported partial write while preserving its original failure', async () => {
  const partial = Object.assign(new Error('Credentials changed before database write failed'), { code: 'SETTINGS_PARTIALLY_APPLIED' })
  const actual = { connections: [{ ...connection, has_api_key: false, api_key_hint: null }] }
  const request = vi.fn().mockResolvedValueOnce(settings).mockRejectedValueOnce(partial).mockResolvedValueOnce(actual)
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ clearKey: true })
  expect(await controller.save()).toBe(false)
  expect(controller.getSnapshot()).toMatchObject({ saved: false, savedKey: false, error: partial.message })
  expect(request.mock.calls[2][1].method).toBeUndefined()
  controller.stop()
})

it('keeps a draft on refresh and only replaces it after a successful explicit reload', async () => {
  const changed = { connections: [{ ...connection, model: 'external-model' }] }
  const request = vi.fn().mockResolvedValueOnce(settings).mockResolvedValueOnce(changed)
    .mockRejectedValueOnce(new Error('reload failed')).mockResolvedValueOnce(changed)
  const controller = new ConnectionController(request)
  await controller.start()
  controller.change({ model: 'my-draft' })
  await controller.start()
  expect(controller.getSnapshot()).toMatchObject({ model: 'my-draft', dirty: true, externalChange: true })
  expect(await controller.reload()).toBe(false)
  expect(controller.getSnapshot()).toMatchObject({ model: 'my-draft', dirty: true, error: 'reload failed' })
  expect(await controller.reload()).toBe(true)
  expect(controller.getSnapshot()).toMatchObject({ model: 'external-model', dirty: false, externalChange: false })
  controller.stop()
})

it('ignores stale loads and stopped save completions', async () => {
  let finish!: (value: unknown) => void
  const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce(settings)
  const controller = new ConnectionController(request)
  const abandoned = controller.start()
  await controller.start()
  finish({ connections: [] })
  await abandoned
  expect(controller.getSnapshot().connection).toEqual(connection)
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  controller.change({ model: 'new-model' })
  const saving = controller.save()
  controller.stop()
  expect(request.mock.calls[2][1].signal.aborted).toBe(true)
  finish(settings)
  expect(await saving).toBe(false)
  expect(request).toHaveBeenCalledTimes(3)
  expect(controller.getSnapshot().saved).toBe(false)
})

it('preserves the generic connection contract for other adapters', async () => {
  const custom = { connections: [{ adapter: 'custom', base_url: 'http://localhost:1234', has_api_key: false }] }
  const request = vi.fn().mockResolvedValue(custom)
  const controller = new ConnectionController(request, 'custom')
  await controller.start()
  expect(await controller.save()).toBe(true)
  expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ connection: { adapter: 'custom', base_url: 'http://localhost:1234' } })
  controller.stop()
})
