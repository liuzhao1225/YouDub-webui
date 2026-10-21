import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
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
  const entries: { slot: string; entry: unknown }[] = []
  const navigation = { push: vi.fn(), replace: vi.fn(), block: (handler: (path: string) => Promise<boolean>) => { blocker = handler; return () => { blocker = undefined } } }
  const context = { apiClient: { request }, navigation, slots: {
    register: (slot: string, entry: SlotMap['shell.routes']) => { entries.push({ slot, entry }); if (slot === 'shell.routes') Page = entry.component; return () => {} },
    subscribe: () => () => {}, getSnapshot: () => 0, list: () => extra,
  }, effect: (effect: () => unknown) => effect() } as unknown as Context
  apply(context)
  const view = render(<PluginContextProvider context={context}><ThemeProvider><LanguageProvider><Page params={section ? { section } : {}} returnTo="/tasks/review?tab=translation" /></LanguageProvider></ThemeProvider></PluginContextProvider>)
  return { ...view, navigation, entries, leave: (path: string) => blocker!(path) }
}
it('registers standalone categories with a footer entry and redirects the old URL', async () => {
  const request = vi.fn(async () => ({}))
  const { entries, navigation, leave } = mount(undefined, request)
  expect(navigation.replace).toHaveBeenCalledWith('/settings/general')
  expect(entries.filter(item => item.slot === 'shell.routes').every(item => (item.entry as SlotMap['shell.routes']).layout === 'standalone')).toBe(true)
  expect(entries.find(item => item.slot === 'shell.navigation')?.entry).toMatchObject({ placement: 'footer' })
  expect(within(screen.getByRole('navigation', { name: '设置' })).getAllByRole('link').map(item => item.textContent)).toEqual(['通用', '服务连接', '环境与模型', '扩展', '关于与更新'])
  expect(screen.getAllByRole('button', { name: '返回' }).every(link => link.getAttribute('href') === '/tasks/review?tab=translation')).toBe(true)
  expect(screen.queryByText('默认处理配置')).not.toBeInTheDocument()
  expect(request).not.toHaveBeenCalled()
  expect(await leave('/settings/connections')).toBe(true)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('saves connection and model together, leaves defaults untouched, and guards actual edits', async () => {
  const connection = { adapter: 'openai', base_url: 'https://example.test/v1', model: 'old-model', has_api_key: true, api_key_hint: 'sk-abc****' }
  const defaults = { translation: { model: 'legacy-model' } }
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    if (init?.method === 'PATCH') { Object.assign(connection, JSON.parse(init.body as string).connection); return {} }
    if (path === '/api/v2/settings') return { connections: [connection], defaults }
    if (path === '/api/v2/catalog') return { providers: [{ id: 'openai', execution: 'remote', label: 'OpenAI', operations: [], models: [] }], workflows: [] }
    return { items: [] }
  })
  const { leave } = mount('connections', request)
  const model = await screen.findByLabelText('模型名称')
  expect(model).toHaveValue('old-model')
  expect(screen.getAllByText('OpenAI 兼容')).toHaveLength(1)
  expect(screen.getByLabelText('API 密钥 · 已保存')).toHaveAttribute('placeholder', 'sk-abc****')
  const user = userEvent.setup()
  await user.clear(model); await user.type(model, 'qwen3-max')
  let leaving!: Promise<boolean>
  await act(async () => { leaving = leave('/settings/general') })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(await leaving).toBe(false)
  await user.click(screen.getByRole('button', { name: '保存修改' }))
  await screen.findByRole('button', { name: '已保存' })
  expect(request.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(init!.body as string))).toEqual([{ connection: { adapter: 'openai', base_url: connection.base_url, model: 'qwen3-max' } }])
  expect(defaults.translation.model).toBe('legacy-model')
  expect(await leave('/settings/general')).toBe(true)
})
it('keeps old plugin settings under Extensions and uses the id when no label is registered', async () => {
  const request = vi.fn(async (path: string): Promise<unknown> => path === '/api/v2/settings' ? { plugins: { legacy: { enabled: true } } } : { items: [] })
  mount('extensions', request, [{ id: 'legacy', component: ({ settings }) => <p>{String(settings.enabled)}</p> }])
  expect(await screen.findByRole('heading', { name: 'legacy' })).toBeInTheDocument()
  expect(screen.getByText('true')).toBeInTheDocument()
})
