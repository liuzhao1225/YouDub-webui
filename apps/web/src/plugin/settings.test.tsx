import type { Context } from 'cordis'
import Schema from '@deepseek-ai/schemastery'
import { useState, type ComponentType } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { ThemeProvider } from '@/lib/theme'
import { PluginContextProvider, type RouteProps, type SlotMap } from './sdk'
import { apply } from './builtin/settings'

afterEach(() => { cleanup(); window.localStorage.clear() })
function mount(section: string | undefined, request = vi.fn(async (_path: string, _init?: RequestInit): Promise<unknown> => ({})), extra: SlotMap['settings.sections'][] = []) {
  let Page!: ComponentType<RouteProps>
  let blocker: ((path: string) => Promise<boolean>) | undefined
  let showSection!: (section: string) => void
  let close!: () => void
  const entries: { slot: string; entry: unknown }[] = []
  const navigation = {
    push: vi.fn(),
    replace: vi.fn(async (path: string) => { if (!blocker || await blocker(path)) showSection(path.split('/')[2]) }),
    dismissDialog: vi.fn(async () => { if (!blocker || await blocker('/tasks/review?tab=translation')) close() }),
    block: vi.fn((handler: (path: string) => Promise<boolean>, _scope?: 'page' | 'dialog') => { blocker = handler; return () => { blocker = undefined } }),
  }
  const context = { apiClient: { request }, navigation, slots: {
    register: (slot: string, entry: SlotMap['shell.routes']) => { entries.push({ slot, entry }); if (slot === 'shell.routes') Page = entry.component; return () => {} },
    subscribe: () => () => {}, getSnapshot: () => 0, list: () => extra,
  }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  function Route() {
    const [active, setActive] = useState(section)
    const [open, setOpen] = useState(true)
    showSection = setActive
    close = () => setOpen(false)
    return open ? <Page params={active ? { section: active } : {}} returnTo="/tasks/review?tab=translation" /> : <p>回到任务</p>
  }
  const view = render(<PluginContextProvider context={context}><ThemeProvider><LanguageProvider><Route /></LanguageProvider></ThemeProvider></PluginContextProvider>)
  return { ...view, navigation, entries, leave: (path: string) => blocker!(path) }
}
it('registers a modal settings surface with five category buttons and redirects the old URL', async () => {
  const request = vi.fn(async () => ({}))
  const { entries, navigation, leave, container } = mount(undefined, request)
  expect(navigation.replace).toHaveBeenCalledWith('/settings/general')
  expect(entries.filter(item => item.slot === 'shell.routes').every(item => (item.entry as SlotMap['shell.routes']).layout === 'dialog')).toBe(true)
  expect(entries.find(item => item.slot === 'shell.navigation')?.entry).toMatchObject({ placement: 'footer' })
  const dialog = screen.getByRole('dialog', { name: '设置' })
  expect(container).not.toContainElement(dialog)
  const categories = within(dialog).getByRole('navigation', { name: '设置分类' })
  expect(within(categories).getAllByRole('button').map(item => item.getAttribute('aria-label'))).toEqual(['通用', '模型', '环境与模型', '扩展', '关于与更新'])
  expect(within(categories).queryByRole('link')).not.toBeInTheDocument()
  expect(within(categories).getByRole('button', { name: '通用' })).toHaveAttribute('aria-current', 'page')
  expect(navigation.block).toHaveBeenLastCalledWith(expect.any(Function), 'dialog')
  expect(screen.queryByText('默认处理配置')).not.toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
  expect(await leave('/settings/connections')).toBe(true)
  expect(screen.queryByRole('dialog', { name: '有未保存的修改' })).not.toBeInTheDocument()
  await userEvent.setup().click(within(categories).getByRole('button', { name: '关于与更新' }))
  expect(navigation.replace).toHaveBeenLastCalledWith('/settings/about')
  expect(within(dialog).getByRole('heading', { name: '关于与更新' })).toBeInTheDocument()
})

it.each(['close button', 'Escape'])('dismisses clean settings through %s', async (action) => {
  const { navigation } = mount('general')
  const user = userEvent.setup()
  const dialog = screen.getByRole('dialog', { name: '设置' })
  if (action === 'close button') await user.click(within(dialog).getByRole('button', { name: '关闭设置' }))
  else await user.keyboard('{Escape}')
  expect(navigation.dismissDialog).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
  expect(screen.getByText('回到任务')).toBeInTheDocument()
})
function modelRequest() {
  let profile = { baseURL: 'https://example.test/v1', apiKeyEnv: 'OPENAI_API_KEY' }
  let revision = 1
  const schema = Schema.object({ providers: Schema.dict(Schema.object({ baseURL: Schema.string(), apiKeyEnv: Schema.string(), api: Schema.union(['openai-completions']), models: Schema.array(Schema.object({ id: Schema.string() })) })) }).toJSON()
  const namespace = () => ({ ns: 'llm-pi-ai', value: { providers: { openai: profile } }, user: { providers: { openai: profile } }, base: {}, revision, schema, secrets: [], applies: 'live' })
  return vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path === '/api/v2/models/providers') return { providers: [{ provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true }] }
    if (path === '/api/v2/models/settings') {
      if (init?.method === 'PATCH') {
        const { ops } = JSON.parse(init.body as string)
        for (const op of ops) profile = { ...profile, [op.path.at(-1)]: op.value }
        revision = 2
        return namespace()
      }
      return { writable: true, hasDocument: false, namespaces: [namespace()] }
    }
    if (path === '/api/v2/models/credentials/describe') return { credentials: { OPENAI_API_KEY: { configured: true, writable: true, hint: 'sk-ab****' } } }
    if (path === '/api/v2/models/discover') return { models: [{ id: 'model-one' }] }
    throw new Error(path)
  })
}

it('redirects the old connection route to the shared Models surface', async () => {
  const { navigation } = mount('connections', modelRequest())
  expect(navigation.replace).toHaveBeenCalledWith('/settings/models')
  expect(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' })).toBeInTheDocument()
})

it('saves a provider profile through the original path protocol and guards actual edits', async () => {
  const request = modelRequest()
  const { leave } = mount('models', request)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  expect(await leave('/settings/general')).toBe(true)
  await user.click(screen.getByText('自定义设置'))
  const url = screen.getByLabelText('API 地址')
  await user.clear(url); await user.type(url, 'https://updated.test/v1')
  const settingsDialog = screen.getByRole('dialog', { name: '设置' })
  await user.click(within(screen.getByRole('navigation', { name: '设置分类' })).getByRole('button', { name: '通用' }))
  const confirmation = screen.getByRole('dialog', { name: '有未保存的修改' })
  expect(settingsDialog).toBeInTheDocument()
  await user.click(within(confirmation).getByRole('button', { name: '继续编辑' }))
  expect(url).toHaveValue('https://updated.test/v1')
  expect(screen.getByRole('heading', { name: '模型' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('已保存 OpenAI (openai)。')
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init!.body as string))).toEqual([{ ns: 'llm-pi-ai', expectedRevision: 1, ops: [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://updated.test/v1' }] }])
  expect(await leave('/settings/general')).toBe(true)
})

it('retains the actual model editor through rejected close and Escape, then discards explicitly', async () => {
  const { navigation } = mount('models', modelRequest())
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  const key = screen.getByLabelText('API 密钥')
  await user.type(key, 'sk-edited-key')
  await user.click(within(screen.getByRole('dialog', { name: '设置' })).getByRole('button', { name: '关闭设置' }))
  const confirmation = screen.getByRole('dialog', { name: '有未保存的修改' })
  expect(navigation.dismissDialog).toHaveBeenCalledOnce()
  await user.keyboard('{Escape}')
  expect(navigation.dismissDialog).toHaveBeenCalledOnce()
  expect(confirmation).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
  expect(key).toHaveValue('sk-edited-key')
  await user.keyboard('{Escape}')
  expect(navigation.dismissDialog).toHaveBeenCalledTimes(2)
  await user.click(within(screen.getByRole('dialog', { name: '有未保存的修改' })).getByRole('button', { name: '放弃修改' }))
  expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
  expect(screen.getByText('回到任务')).toBeInTheDocument()
})
it('closes the nested model picker with Escape while retaining the settings editor', async () => {
  const { navigation } = mount('models', modelRequest())
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  await user.click(screen.getByText('自定义设置'))
  await user.click(screen.getByRole('button', { name: '获取可用模型' }))
  await screen.findByRole('dialog', { name: '选择要添加的模型' })
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: '选择要添加的模型' })).not.toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
  expect(screen.getByLabelText('API 地址')).toHaveValue('https://example.test/v1')
  expect(navigation.dismissDialog).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: '获取可用模型' })).toHaveFocus())
})
it('keeps settings mounted during the profile and credential writes, then unlocks after completion', async () => {
  const base = modelRequest()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    if (init?.method === 'PATCH') await pending
    return base(path, init)
  })
  const { navigation, leave } = mount('models', request)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '编辑 OpenAI (openai)' }))
  await user.click(screen.getByText('自定义设置'))
  await user.type(screen.getByLabelText('API 地址'), '/updated')
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(within(screen.getByRole('dialog', { name: '设置' })).getByRole('button', { name: '关闭设置' })).toBeDisabled()
  expect(within(screen.getByRole('navigation', { name: '设置分类' })).getByRole('button', { name: '通用' })).toBeDisabled()
  expect(await leave('/settings/general')).toBe(false)
  await user.keyboard('{Escape}')
  expect(navigation.dismissDialog).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
  release()
  await screen.findByText('已保存 OpenAI (openai)。')
  await waitFor(() => expect(within(screen.getByRole('dialog', { name: '设置' })).getByRole('button', { name: '关闭设置' })).not.toBeDisabled())
  expect(await leave('/settings/general')).toBe(true)
})
it('keeps old plugin settings under Extensions and uses the id when no label is registered', async () => {
  const request = vi.fn(async (path: string): Promise<unknown> => path === '/api/v2/settings' ? { plugins: { legacy: { enabled: true } } } : { items: [] })
  mount('extensions', request, [{ id: 'legacy', component: ({ settings }) => <p>{String(settings.enabled)}</p> }])
  expect(await screen.findByRole('heading', { name: 'legacy' })).toBeInTheDocument()
  expect(screen.getByText('true')).toBeInTheDocument()
})
