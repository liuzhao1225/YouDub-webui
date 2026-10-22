/** Native settings reads retain the original authenticated, correlated Web RPC boundary. */
import { describe, expect, it, vi } from 'vitest'
import { connectDesktopSettings } from '../src/desktop-settings.ts'

const url = 'http://127.0.0.1:19387/?token=fixture'
function transport(preference?: unknown) {
  const send = vi.fn<Parameters<typeof connectDesktopSettings>[1]>(async (_input, init) => {
    if (init?.method !== 'POST') return new Response('index')
    const { rpcId, method } = JSON.parse(init.body as string) as { rpcId: string; method: string }
    if (method !== 'settings/describe') throw new Error(`Unexpected RPC: ${method}`)
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: {
      namespaces: [{ ns: 'locale', value: preference === undefined ? {} : { preference } }],
    } } })
  })
  return send
}

describe('desktop settings Web operations', () => {
  it.each([undefined, 'zh', 'en', 'ja'])('reads language %s without querying account or providers', async preference => {
    const send = transport(preference)
    const backend = await connectDesktopSettings(url, send)
    expect(send).toHaveBeenCalledExactlyOnceWith(url, { credentials: 'include' })
    send.mockClear()
    expect(await backend.readLocalePreference()).toBe(preference ?? null)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0]![0]).toBe('http://127.0.0.1:19387/api/settings/describe')
    expect(send.mock.calls[0]![1]).toMatchObject({ credentials: 'include', redirect: 'error' })
  })

  it('refuses an unauthenticated Web launch', async () => {
    const send = vi.fn<Parameters<typeof connectDesktopSettings>[1]>(async () => new Response(null, { status: 401 }))
    await expect(connectDesktopSettings(url, send)).rejects.toThrow('Web authentication failed')
  })

  it('rejects unmatched RPC envelopes and preserves transport failures', async () => {
    const send = transport()
    const backend = await connectDesktopSettings(url, send)
    send.mockResolvedValueOnce(Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true } }))
    await expect(backend.readLocalePreference()).rejects.toThrow('Web RPC failed')
    send.mockRejectedValueOnce(new Error('connection closed'))
    await expect(backend.readLocalePreference()).rejects.toThrow('connection closed')
  })

  it('rejects malformed saved language preferences', async () => {
    const backend = await connectDesktopSettings(url, transport(42))
    await expect(backend.readLocalePreference()).rejects.toThrow('invalid locale preference')
  })
})
