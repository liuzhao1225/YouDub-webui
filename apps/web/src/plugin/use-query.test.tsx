import { Context, type Fiber } from 'cordis'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginContextProvider, requireActive } from './sdk'
import * as apiPlugin from './builtin/api'
import { useQuery } from './builtin/use-query'

const fibers: Fiber[] = []
afterEach(async () => {
  cleanup()
  await Promise.all(fibers.splice(0).map((fiber) => fiber.dispose()))
  vi.unstubAllGlobals()
})

it('keeps a slower runtime request alive when the catalog resolves through Cordis service proxies', async () => {
  const requests: Array<{ path: string; signal: AbortSignal; resolve(response: Response): void }> = []
  vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init.signal as AbortSignal
    requests.push({ path, signal, resolve })
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  })))
  const root = new Context()
  const provider = root.plugin(apiPlugin)
  fibers.push(provider)
  await requireActive(provider, 'api')
  let viewer!: Context
  const consumer = root.inject(['apiClient'], (context) => { viewer = context })
  fibers.push(consumer)
  await requireActive(consumer, 'viewer')
  expect(viewer.apiClient).not.toBe(viewer.apiClient)
  function EditorQueries() {
    const runtime = useQuery<{ ready: boolean }>('/api/v1/runtime')
    const catalog = useQuery<{ ready: boolean }>('/api/v2/catalog')
    return <><p data-testid="runtime">{runtime.data?.ready ? 'ready' : runtime.error || 'loading'}</p><p data-testid="catalog">{catalog.data?.ready ? 'ready' : catalog.error || 'loading'}</p></>
  }
  render(<PluginContextProvider context={viewer}><EditorQueries /></PluginContextProvider>)
  await waitFor(() => expect(requests).toHaveLength(2))
  const runtime = requests.find((request) => request.path === '/api/v1/runtime')!
  const catalog = requests.find((request) => request.path === '/api/v2/catalog')!
  catalog.resolve(Response.json({ ready: true }))
  await waitFor(() => expect(screen.getByTestId('catalog')).toHaveTextContent('ready'))
  expect(runtime.signal.aborted).toBe(false)
  expect(requests).toHaveLength(2)
  runtime.resolve(Response.json({ ready: true }))
  await waitFor(() => expect(screen.getByTestId('runtime')).toHaveTextContent('ready'))
  expect(requests).toHaveLength(2)
})
