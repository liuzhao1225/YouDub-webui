import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TranslationSetup } from './translation-setup'

// The shared provider editor has its own source-derived editor/discovery tests.
vi.mock('./models-settings', () => ({ ModelsSettings: ({ onReadyChange, onDirtyChange, onBusyChange }: { onReadyChange(ready: boolean): void; onDirtyChange(dirty: boolean): void; onBusyChange(busy: boolean): void }) => <div><h1>模型</h1><button onClick={() => onReadyChange(true)}>保存供应商</button><button onClick={() => onDirtyChange(true)}>编辑供应商</button><button onClick={() => onBusyChange(true)}>正在保存</button></div> }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function server(providers: unknown[] = [], failSkip = false) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/auth/session') return Response.json({ csrf_token: 'csrf' })
    if (path === '/api/v2/catalog') return Response.json({ providers })
    if (init?.method === 'PATCH' && failSkip) return Response.json({ error: { message: '保存失败' } }, { status: 500 })
    return Response.json({})
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
it('uses the shared model editor and waits for a usable saved provider before continuing', async () => {
  const fetch = server()
  render(<TranslationSetup><div>工作台</div></TranslationSetup>)
  expect(await screen.findByRole('heading', { name: '模型' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '继续' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '保存供应商' }))
  expect(screen.queryByText('工作台')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续' }))
  expect(await screen.findByText('工作台')).toBeInTheDocument()
  expect(fetch.mock.calls.every(([path]) => !path.includes('test-connection') && !path.includes('resources'))).toBe(true)
})
it('allows deferral without saving a key and includes CSRF protection', async () => {
  const fetch = server()
  render(<TranslationSetup><div>工作台</div></TranslationSetup>)
  fireEvent.click(await screen.findByText('稍后配置'))
  await screen.findByText('工作台')
  const patch = fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')![1]!
  expect(JSON.parse(patch.body as string)).toEqual({ plugin: { id: 'youdub.onboarding', config: { translationDeferred: true } } })
  expect((patch.headers as Headers).get('X-CSRF-Token')).toBe('csrf')
})
it('keeps a failed deferral visible', async () => {
  server([], true)
  render(<TranslationSetup><div>工作台</div></TranslationSetup>)
  fireEvent.click(await screen.findByText('稍后配置'))
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败')
  expect(screen.queryByText('工作台')).not.toBeInTheDocument()
})
it('opens the workbench for an available modern translation provider without testing it', async () => {
  const fetch = server([{ id: 'llm.anthropic', capability: 'translation', available: true }])
  render(<TranslationSetup><div>工作台</div></TranslationSetup>)
  await screen.findByText('工作台')
  expect(fetch).toHaveBeenCalledTimes(3)
})
it('does not use a legacy or unavailable provider as first-run readiness', async () => {
  server([{ id: 'openai', capability: 'translation', available: true, legacy: true }, { id: 'llm.example', capability: 'translation', available: false }])
  render(<TranslationSetup><div>工作台</div></TranslationSetup>)
  await screen.findByRole('heading', { name: '模型' })
  expect(screen.queryByText('工作台')).not.toBeInTheDocument()
})

it.each(['编辑供应商', '正在保存'])('keeps first-run setup open while %s', async (action) => {
  server()
  render(<TranslationSetup><div>工作台</div></TranslationSetup>)
  fireEvent.click(await screen.findByRole('button', { name: '保存供应商' }))
  fireEvent.click(screen.getByRole('button', { name: action }))
  expect(screen.getByRole('button', { name: '继续' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '稍后配置' })).toBeDisabled()
})
