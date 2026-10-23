import { requireActive } from './test-bindings'
import { Context, type Fiber } from 'cordis'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginContextProvider, bindComponent, type Bindings } from './sdk'
import * as apiPlugin from './builtin/api'

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
  function EditorQueries({ useQuery }: Bindings<'useQuery'>) {
    const runtime = useQuery<{ ready: boolean }>('/api/v2/runtime')
    const catalog = useQuery<{ ready: boolean }>('/api/v2/catalog')
    return <><p data-testid="runtime">{runtime.data?.ready ? 'ready' : runtime.error || 'loading'}</p><p data-testid="catalog">{catalog.data?.ready ? 'ready' : catalog.error || 'loading'}</p></>
  }
  const BoundEditor = bindComponent(viewer, ['useQuery'], EditorQueries)
  render(<PluginContextProvider context={viewer}><BoundEditor /></PluginContextProvider>)
  await waitFor(() => expect(requests).toHaveLength(2))
  const runtime = requests.find((request) => request.path === '/api/v2/runtime')!
  const catalog = requests.find((request) => request.path === '/api/v2/catalog')!
  catalog.resolve(Response.json({ ready: true }))
  await waitFor(() => expect(screen.getByTestId('catalog')).toHaveTextContent('ready'))
  expect(runtime.signal.aborted).toBe(false)
  expect(requests).toHaveLength(2)
  runtime.resolve(Response.json({ ready: true }))
  await waitFor(() => expect(screen.getByTestId('runtime')).toHaveTextContent('ready'))
  expect(requests).toHaveLength(2)
})

it('does not show a previous query result or error after the query path changes', async () => {
  const request = vi.fn(async (path: string) => {
    if (path === '/first') return { name: 'first task' }
    throw new Error('Second filter failed')
  })
  const context = { apiClient: { request } } as unknown as Context
  function Viewer({ path, useQuery }: { path: string } & Bindings<'useQuery'>) {
    const { data, error } = useQuery<{ name: string }>(path)
    return <p>{data?.name || error || 'loading'}</p>
  }
  const BoundViewer = bindComponent(context, ['useQuery'], Viewer)
  const view = render(<PluginContextProvider context={context}><BoundViewer path="/first" /></PluginContextProvider>)
  await screen.findByText('first task')
  view.rerender(<PluginContextProvider context={context}><BoundViewer path="/second" /></PluginContextProvider>)
  expect(screen.queryByText('first task')).not.toBeInTheDocument()
  await screen.findByText('Second filter failed')
})
