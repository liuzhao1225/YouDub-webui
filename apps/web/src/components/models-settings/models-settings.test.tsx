import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { LanguageProvider } from '@/lib/i18n'
import { HttpError } from '@/runtime/http'
import type { Request } from '@/plugin/runtime/types'
import { ModelsSettings } from './index'
import { modelsApi } from './api'
import { deletePath, setPath } from './schema-form'
import type { CredentialView, SettingsNamespaceView, SettingsPathOpView } from './types'

afterEach(() => { cleanup(); localStorage.clear() })

function fixture(unavailableReason?: string) {
  const profile = Schema.object({
    apiKeyEnv: Schema.string(), baseURL: Schema.string(), displayName: Schema.string(),
    api: Schema.union(['openai-completions', 'openai-responses', 'anthropic-messages']),
    models: Schema.array(Schema.object({ id: Schema.string(), name: Schema.string(), contextWindow: Schema.number(), maxTokens: Schema.number() })),
  })
  const schema = Schema.object({ providers: Schema.dict(profile) })
  const namespace: SettingsNamespaceView = {
    ns: 'llm-pi-ai', schema: schema.toJSON(), applies: 'live', secrets: [], revision: 7, base: {},
    user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://example.test/v1' } } },
    value: {},
  }
  namespace.value = structuredClone(namespace.user)
  const credentials: Record<string, CredentialView> = { OPENAI_API_KEY: { configured: true, writable: true, hint: 'sk-ab****' } }
  const calls: { path: string; method: string; body: any }[] = []
  let failKey = false
  let conflict = false
  let discoverError = ''
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<any> => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ path, method, body })
    if (path === '/api/v2/models/providers') {
      const profiles = (namespace.value as { providers: Record<string, unknown> }).providers
      return { providers: [...new Set(['openai', 'deepseek', 'anthropic', ...Object.keys(profiles)])].map(provider => ({
        provider, displayName: provider === 'openai' ? 'OpenAI' : provider === 'deepseek' ? 'DeepSeek' : provider,
        settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider], active: Boolean(profiles[provider]) && !unavailableReason, declared: !['openai', 'deepseek', 'anthropic'].includes(provider),
        ...(profiles[provider] && unavailableReason ? { unavailableReason } : {}),
      })) }
    }
    if (path === '/api/v2/models/settings' && method === 'GET') return { writable: true, hasDocument: false, namespaces: [structuredClone(namespace)] }
    if (path === '/api/v2/models/settings' && method === 'PATCH') {
      if (conflict) throw new HttpError('revision changed', 409, 'settings-conflict')
      for (const op of body.ops as SettingsPathOpView[]) {
        namespace.user = op.op === 'set' ? setPath(namespace.user as Record<string, unknown>, op.path, op.value) : deletePath(namespace.user as Record<string, unknown>, op.path)
      }
      namespace.value = structuredClone(namespace.user); namespace.revision++
      return structuredClone(namespace)
    }
    if (path === '/api/v2/models/credentials/describe') return { credentials: Object.fromEntries(body.refs.map((ref: string) => [ref, credentials[ref] ?? { configured: false, writable: true }])) }
    if (path.startsWith('/api/v2/models/credentials/') && method === 'PUT') {
      if (failKey) { failKey = false; throw new HttpError('credential disk is read-only', 500, 'credential-write-failed') }
      credentials[decodeURIComponent(path.split('/').at(-1)!)] = { configured: true, writable: true, hint: 'sk-ne****' }
      return {}
    }
    if (path.startsWith('/api/v2/models/credentials/') && method === 'DELETE') { delete credentials[decodeURIComponent(path.split('/').at(-1)!)]; return {} }
    if (path === '/api/v2/models/discover') {
      if (discoverError) throw new HttpError(discoverError, 502, 'discovery-failed')
      return { models: [{ id: 'model-one', name: 'Model One', contextWindow: 131072, maxTokens: 65535 }, { id: 'model-two' }] }
    }
    throw new Error(`Unexpected ${method} ${path}`)
  }) as unknown as Request
  return { request, calls, namespace, failNextKey: () => { failKey = true }, conflict: () => { conflict = true }, failDiscovery: () => { discoverError = 'upstream HTTP 404' } }
}

function mount(data = fixture()) {
  const dirty = vi.fn(), ready = vi.fn()
  render(<LanguageProvider><ModelsSettings request={data.request} onDirtyChange={dirty} onReadyChange={ready} /></LanguageProvider>)
  return { ...data, dirty, ready, user: userEvent.setup() }
}

it('shows the provider unavailability reason while distinguishing a saved key from readiness', async () => {
  const reason = 'No model supports the required 65535 output tokens.'
  const { ready } = mount(fixture(reason))
  expect(await screen.findByRole('alert')).toHaveTextContent(reason)
  expect(screen.getByRole('img', { name: 'API 密钥已配置' })).toBeInTheDocument()
  expect(ready).toHaveBeenLastCalledWith(false)
})

it('uses the provider directory, preserves masked keys, and reports only actual unsaved changes', async () => {
  const { user, dirty, ready, calls } = mount()
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  await waitFor(() => expect(screen.getByLabelText('API 密钥')).toHaveAttribute('placeholder', expect.stringContaining('sk-ab****')))
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(ready).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByText('自定义设置'))
  const url = screen.getByLabelText('API 地址')
  await user.clear(url); await user.type(url, 'https://new.example/v1')
  expect(dirty).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('已保存 OpenAI (openai)。')
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(calls.filter(call => call.method === 'PATCH')).toEqual([{ path: '/api/v2/models/settings', method: 'PATCH', body: { ns: 'llm-pi-ai', expectedRevision: 7, ops: [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://new.example/v1' }] } }])
  expect(calls.some(call => call.method === 'PUT')).toBe(false)
  await user.click(screen.getByRole('tab', { name: '第三方模型提供商' }))
  await user.click(screen.getByRole('button', { name: '提供方' }))
  expect(screen.getByRole('menuitem', { name: 'DeepSeek' })).toBeInTheDocument()
  expect(dirty).toHaveBeenLastCalledWith(false)
})

it('keeps edited fields and visible conflict errors when another writer changes the revision', async () => {
  const data = fixture(); data.conflict()
  const { user, dirty } = mount(data)
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  await user.click(screen.getByText('自定义设置'))
  await user.type(screen.getByLabelText('API 地址'), '/changed')
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByText(/这些设置已被其他地方改动/)).toBeInTheDocument()
  expect(screen.getByLabelText('API 地址')).toHaveValue('https://example.test/v1/changed')
  expect(dirty).toHaveBeenLastCalledWith(true)
})

it('discovers from unsaved custom fields, adopts models locally, and retries only a failed credential write', async () => {
  const data = fixture(); data.failNextKey()
  const { user, calls, dirty } = mount(data)
  await user.click(await screen.findByRole('tab', { name: '自定义模型 API' }))
  expect(dirty).toHaveBeenLastCalledWith(false)
  // Exercise every protocol through the actual menu, then preserve the original selection.
  for (const name of ['OpenAI Responses', 'Anthropic Messages', 'OpenAI Chat Completions']) {
    await user.click(screen.getByLabelText('API 协议'))
    await user.click(screen.getByRole('menuitem', { name }))
    expect(screen.getByLabelText('API 协议')).toHaveTextContent(name)
  }
  await user.type(screen.getByLabelText('Provider ID'), 'acme')
  await user.type(screen.getByLabelText('API 地址'), 'https://acme.example/v1')
  await user.type(screen.getByLabelText('API 密钥'), 'sk-new-key')
  await user.click(screen.getByRole('button', { name: '获取可用模型' }))
  const picker = await screen.findByRole('dialog', { name: '选择要添加的模型' })
  await user.click(within(picker).getByLabelText('model-one'))
  await user.click(within(picker).getByRole('button', { name: '添加所选' }))
  expect(calls.find(call => call.path.endsWith('/discover'))?.body).toEqual({ settingsNs: 'llm-pi-ai', baseURL: 'https://acme.example/v1', api: 'openai-completions', apiKey: 'sk-new-key' })
  expect(calls.some(call => call.method === 'PATCH')).toBe(false)
  await user.click(screen.getByRole('button', { name: '创建提供方' }))
  expect(await screen.findByText('credential disk is read-only')).toBeInTheDocument()
  expect(screen.getByLabelText('Provider ID')).toBeDisabled()
  expect(dirty).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: '创建提供方' }))
  await screen.findByRole('button', { name: '编辑 acme' })
  expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(1)
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(2)
  expect(dirty).toHaveBeenLastCalledWith(false)
})

it.each([
  ['OpenAI Responses', 'openai-responses'],
  ['Anthropic Messages', 'anthropic-messages'],
])('sends the selected %s protocol when discovering custom models', async (name, api) => {
  const { user, calls } = mount()
  await user.click(await screen.findByRole('tab', { name: '自定义模型 API' }))
  await user.click(screen.getByLabelText('API 协议'))
  await user.click(screen.getByRole('menuitem', { name }))
  await user.type(screen.getByLabelText('API 地址'), 'https://acme.example/v1')
  await user.click(screen.getByRole('button', { name: '获取可用模型' }))
  await screen.findByRole('dialog', { name: '选择要添加的模型' })
  expect(calls.find(call => call.path.endsWith('/discover'))?.body).toMatchObject({ api, baseURL: 'https://acme.example/v1' })
})

it('surfaces discovery failure while preserving manual model entry', async () => {
  const data = fixture(); data.failDiscovery()
  const { user } = mount(data)
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  await user.click(screen.getByText('自定义设置'))
  await user.click(screen.getByRole('button', { name: '获取可用模型' }))
  expect(await screen.findByText('upstream HTTP 404')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '添加模型' }))
  expect(screen.getByLabelText('模型 ID 1')).toBeInTheDocument()
})

it('requires explicit deletion confirmation and deletes only the selected provider and its managed key', async () => {
  const { user, calls } = mount()
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  await user.click(await screen.findByRole('button', { name: '删除 OpenAI (openai)' }))
  const dialog = screen.getByRole('dialog', { name: '删除 OpenAI (openai)？' })
  expect(calls.some(call => call.method === 'DELETE')).toBe(false)
  await user.click(within(dialog).getByRole('button', { name: '删除 OpenAI (openai)' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '编辑 OpenAI (openai)' })).not.toBeInTheDocument())
  expect(calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual(['/api/v2/models/credentials/OPENAI_API_KEY'])
  expect(calls.find(call => call.method === 'PATCH')?.body.ops).toEqual([{ op: 'unset', path: ['providers', 'openai'] }])
  expect(screen.getByRole('tab', { name: '第三方模型提供商' })).toBeInTheDocument()
})

it('preserves business and transport errors in the narrow HTTP facade', async () => {
  const request: Request = async () => { throw new HttpError('revision changed', 409, 'settings-conflict') }
  expect(await modelsApi(request).settings.mutate({ ns: 'llm-pi-ai', ops: [] })).toEqual({ result: { ok: false, error: { code: 'settings-conflict', message: 'revision changed' } } })
  const offline: Request = async () => { throw new Error('offline') }
  await expect(modelsApi(offline).llm.providers({})).rejects.toThrow('offline')
})
