import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'
import { PluginContextProvider, type RouteProps, type SlotMap } from './sdk'
import { apply } from './builtin/settings'

afterEach(() => { cleanup(); window.localStorage.clear() })
it('freezes connection inputs during saving and refreshes provider readiness after success', async () => {
  let finish!: (value: unknown) => void
  let saved = false
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Promise((resolve) => { finish = resolve })
    if (path === '/api/v2/settings') return { connections: [{ adapter: 'example', base_url: 'https://example.test/v1', has_api_key: saved }] }
    if (path === '/api/v2/catalog') return { workflows: [], providers: [{ id: 'example', adapter: 'example', label: 'Example', operations: [], available: saved, unavailableReason: 'Configure connection', models: [{ id: 'gpt', devices: ['remote'] }] }] }
    return { items: [] }
  })
  let Page!: ComponentType<RouteProps>
  const context = { apiClient: { request }, slots: {
    register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [],
  }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><ThemeProvider><LanguageProvider><Page params={{}} /></LanguageProvider></ThemeProvider></PluginContextProvider>)
  const key = await screen.findByLabelText('API Key')
  const user = userEvent.setup()
  await user.type(key, 'new-key')
  await user.click(screen.getByRole('button', { name: '保存连接' }))
  expect(key).toBeDisabled()
  expect(screen.getByLabelText('服务地址')).toBeDisabled()
  saved = true
  await act(async () => finish({}))
  await screen.findByRole('button', { name: '已保存' })
  await waitFor(() => expect(request.mock.calls.filter(([path]) => path === '/api/v2/catalog')).toHaveLength(2))
  expect(screen.getByText('已就绪')).toBeInTheDocument()
  await user.type(key, 'changed-key')
  expect(screen.getByRole('button', { name: '保存连接' })).toBeInTheDocument()
})

it('probes runtime before refreshing its catalog, serializes clicks and surfaces probe failures without retrying', async () => {
  let finish!: (value: unknown) => void
  let fail!: (error: Error) => void
  let ready = false
  const request = vi.fn(async (path: string) => {
    if (path === '/api/v2/runtime') return new Promise((resolve, reject) => { finish = resolve; fail = reject })
    if (path === '/api/v2/catalog') return { workflows: [], providers: [{ id: 'whisper', label: 'Whisper', operations: [], available: ready, unavailableReason: 'Model missing', models: [] }] }
    if (path === '/api/v2/settings') return { connections: [] }
    return { items: [] }
  })
  let Page!: ComponentType<RouteProps>
  const context = { apiClient: { request }, slots: {
    register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [],
  }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><ThemeProvider><LanguageProvider><Page params={{}} /></LanguageProvider></ThemeProvider></PluginContextProvider>)
  await screen.findByText('Model missing')
  const button = screen.getByRole('button', { name: '刷新' })
  const user = userEvent.setup()
  await user.dblClick(button)
  expect(request.mock.calls.filter(([path]) => path === '/api/v2/runtime')).toHaveLength(1)
  expect(button).toBeDisabled()
  expect(request.mock.calls.filter(([path]) => path === '/api/v2/catalog')).toHaveLength(1)
  await act(async () => fail(new Error('Runtime probe failed')))
  await screen.findByText('Runtime probe failed')
  expect(button).toBeEnabled()
  expect(request.mock.calls.filter(([path]) => path === '/api/v2/runtime')).toHaveLength(1)
  expect(request.mock.calls.filter(([path]) => path === '/api/v2/catalog')).toHaveLength(1)
  await user.click(button)
  ready = true
  await act(async () => finish({}))
  await screen.findByText('已就绪')
  expect(screen.queryByText('Runtime probe failed')).not.toBeInTheDocument()
  expect(request.mock.calls.map(([path]) => path).slice(-2)).toEqual(['/api/v2/runtime', '/api/v2/catalog'])
})

// Remote providers have no models until their first connection is configured.
it('shows an unconfigured remote connection without requiring model discovery', async () => {
  const request = vi.fn(async (path: string) => {
    if (path === '/api/v2/settings') return { connections: [] }
    if (path === '/api/v2/catalog') return { workflows: [], providers: [
      { id: 'remote-provider', adapter: 'custom-remote', execution: 'remote', label: 'Remote', operations: [], available: false, models: [] },
      { id: 'local-provider', execution: 'local', label: 'Local', operations: [], available: false, models: [] },
    ] }
    return { items: [] }
  })
  let Page!: ComponentType<RouteProps>
  const context = { apiClient: { request }, slots: {
    register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [],
  }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><ThemeProvider><LanguageProvider><Page params={{}} /></LanguageProvider></ThemeProvider></PluginContextProvider>)
  expect(await screen.findByLabelText('服务地址')).toHaveAttribute('id', 'connection-custom-remote')
  expect(screen.getAllByLabelText('API Key')).toHaveLength(1)
  expect(screen.getByRole('button', { name: '保存连接' })).toBeEnabled()
  expect(request.mock.calls.every(([path]) => path !== '/api/v2/runtime')).toBe(true)
})

const translationDefaults = {
  source_language: 'auto', target_language: 'zh', output_mode: 'subtitles', keep_background: false,
  asr: { adapter: 'whisper', model: 'tiny', device: 'cpu', initial_prompt: 'YouDub' },
  translation: { adapter: 'openai', model: 'old-model', device: 'remote' }, tts: null, separation: null,
}
function mountConnections(request: ReturnType<typeof vi.fn>) {
  let Page!: ComponentType<RouteProps>
  const context = { apiClient: { request }, slots: {
    register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} },
    subscribe: () => () => {}, getSnapshot: () => 0, list: () => [],
  }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><ThemeProvider><LanguageProvider><Page params={{}} /></LanguageProvider></ThemeProvider></PluginContextProvider>)
}

it.each([true, false])('saves a custom translation model, preserving current defaults and the saved key (defaults exist: %s)', async (existing) => {
  let defaults = existing ? structuredClone(translationDefaults) : null
  const connection = { adapter: 'openai', base_url: 'https://example.test/v1', has_api_key: true, api_key_hint: 'sk-abc****' }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(init.body as string)
      if (patch.defaults) defaults = patch.defaults
      return { connections: [connection], defaults }
    }
    if (path === '/api/v2/settings') return { connections: [connection], defaults }
    if (path === '/api/v2/catalog') return { providers: [], workflows: [{ id: 'youdub.localize', defaults: translationDefaults }] }
    return { items: [] }
  })
  mountConnections(request)
  const model = await screen.findByLabelText('模型名称')
  expect(model).toHaveValue('old-model')
  expect(screen.getByLabelText('API Key · 已保存')).toHaveAttribute('placeholder', 'sk-abc****')
  expect(screen.getByLabelText('API Key · 已保存')).toHaveValue('')
  if (defaults) defaults.asr.initial_prompt = 'Updated elsewhere'
  const user = userEvent.setup()
  await user.clear(model)
  await user.type(model, '  custom/mimo-v2.6-flash  ')
  await user.click(screen.getByRole('button', { name: '保存连接' }))
  await screen.findByRole('button', { name: '已保存' })
  const patches = request.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init!.body as string))
  expect(patches).toEqual([
    { connection: { adapter: 'openai', base_url: connection.base_url } },
    { defaults: { ...translationDefaults, asr: { ...translationDefaults.asr, initial_prompt: existing ? 'Updated elsewhere' : 'YouDub' },
      translation: { adapter: 'openai', model: 'custom/mimo-v2.6-flash', device: 'remote' } } },
  ])
  expect(request.mock.calls.some(([path]) => path === '/api/v2/settings/test-connection')).toBe(false)
})

it('reports that the connection was saved when saving the model fails, without retrying or reporting success', async () => {
  let connected = false
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const patch = JSON.parse(init.body as string)
      if (patch.defaults) throw new Error('Model settings write failed')
      connected = true
      return {}
    }
    if (path === '/api/v2/settings') return { connections: connected ? [{ adapter: 'openai', base_url: 'https://example.test/v1', has_api_key: true }] : [], defaults: translationDefaults }
    if (path === '/api/v2/catalog') return { workflows: [{ id: 'youdub.localize', defaults: translationDefaults }], providers: [{ id: 'openai', execution: 'remote', operations: [], models: [] }] }
    return { items: [] }
  })
  mountConnections(request)
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('服务地址'), 'https://example.test/v1')
  await user.type(screen.getByLabelText('API Key'), 'test-only-key')
  await user.click(screen.getByRole('button', { name: '保存连接' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('连接已保存，模型设置失败：Model settings write failed')
  expect(screen.queryByRole('button', { name: '已保存' })).not.toBeInTheDocument()
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(2)
})

it('tests the entered model with the saved key, and requires a new key after changing the address', async () => {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') throw new Error('Testing must not save settings')
    if (path === '/api/v2/settings/test-connection') return { ok: true }
    if (path === '/api/v2/settings') return { connections: [{ adapter: 'openai', base_url: 'https://example.test/v1', has_api_key: true, api_key_hint: 'sk-abc****' }], defaults: translationDefaults }
    if (path === '/api/v2/catalog') return { providers: [], workflows: [] }
    return { items: [] }
  })
  mountConnections(request)
  const user = userEvent.setup()
  const model = await screen.findByLabelText('模型名称')
  await user.clear(model)
  await user.type(model, 'new-model')
  await user.click(screen.getByRole('button', { name: '测试连接' }))
  await screen.findByRole('button', { name: '连接测试通过' })
  expect(request).toHaveBeenCalledWith('/api/v2/settings/test-connection', { method: 'POST', body: JSON.stringify({ base_url: 'https://example.test/v1', model: 'new-model' }) })
  await user.click(screen.getByLabelText('清除已保存密钥'))
  expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '')
  await user.click(screen.getByLabelText('清除已保存密钥'))
  expect(screen.getByLabelText('API Key · 已保存')).toHaveAttribute('placeholder', 'sk-abc****')
  const url = screen.getByLabelText('服务地址')
  await user.clear(url)
  await user.type(url, 'https://different.test/v1')
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  expect(screen.getByLabelText('API Key')).toBeRequired()
  expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '')
  expect(request.mock.calls.filter(call => (call[1] as RequestInit | undefined)?.method === 'PATCH')).toHaveLength(0)
})
