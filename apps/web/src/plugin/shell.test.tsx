import type { Context } from 'cordis'
import { useEffect, useState, type ComponentType } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginContextProvider, type RouteEntry, type SlotMap } from './sdk'
import { apply } from './builtin/shell'
import { apply as studioPlugin } from './builtin/studio'
import { apply as libraryPlugin } from './builtin/library'
import { apply as workflowsPlugin } from './builtin/workflows'
import { apply as settingsPlugin } from './builtin/settings'

afterEach(() => { cleanup(); window.localStorage.clear(); window.history.replaceState(null, '', '/') })

function setup(path = '/') {
  let current = path
  window.history.replaceState(null, '', path)
  const listeners = new Set<() => void>()
  const blockers = new Set<(path: string) => Promise<boolean>>()
  const mounted = vi.fn(), unmounted = vi.fn()
  function TaskDetail() {
    const [note, setNote] = useState('')
    useEffect(() => { mounted(); return () => { unmounted() } }, [])
    return <><h1>任务详情</h1><input aria-label="任务笔记" value={note} onChange={event => setNote(event.target.value)} /></>
  }
  const snapshot = { status: 'authenticated' as const }
  const routes: RouteEntry[] = [
    { id: 'studio', path: '/', component: () => <h1>主页</h1>, access: 'authenticated' },
    { id: 'library', path: '/tasks', component: () => <h1>任务</h1>, access: 'authenticated' },
    { id: 'detail', path: '/tasks/:id', component: TaskDetail, access: 'authenticated' },
    { id: 'workflows', path: '/workflows', component: () => <h1>工作流页</h1>, access: 'authenticated' },
    { id: 'extra', path: '/extra', component: () => <h1>扩展页</h1>, access: 'authenticated' },
  ]
  const entries: SlotMap['shell.navigation'][] = [
    { id: 'extra', routeId: 'extra', label: '扩展', order: 40 },
  ]
  let Root!: ComponentType
  const change = (next: string) => {
    const state = next.startsWith('/settings') ? { youdubReturnTo: window.history.state?.youdubReturnTo ?? current } : null
    window.history.replaceState(state, '', next)
    current = next
    listeners.forEach(listener => listener())
  }
  const navigate = async (next: string) => { for (const blocker of blockers) if (!await blocker(next)) return; change(next) }
  const dismissDialog = vi.fn(() => navigate(window.history.state?.youdubReturnTo ?? '/'))
  const context = {
    apiClient: { request: vi.fn(async () => ({ currentVersion: 'test', supported: false, automatic: false })) },
    session: { subscribe: () => () => {}, getSnapshot: () => snapshot, logout: vi.fn() },
    navigation: {
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      getSnapshot: () => current,
      href: (id: string) => routes.find((route) => route.id === id)!.path,
      push: navigate, replace: navigate, dismissDialog,
      block: (handler: (path: string) => Promise<boolean>) => { blockers.add(handler); return () => blockers.delete(handler) },
    },
    slots: { subscribe: () => () => {}, getSnapshot: () => 0,
      list: (slot: string) => slot === 'shell.routes' ? routes : slot === 'shell.navigation' ? entries : [],
      register: (slot: string, entry: SlotMap['root'] | SlotMap['shell.navigation'] | RouteEntry) => {
        if (slot === 'root') Root = (entry as SlotMap['root']).component
        if (slot === 'shell.navigation') entries.push(entry as SlotMap['shell.navigation'])
        if (slot === 'shell.routes' && (entry as RouteEntry).layout === 'dialog') routes.push(entry as RouteEntry)
        return () => {}
      },
    },
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  for (const plugin of [settingsPlugin, workflowsPlugin, libraryPlugin, studioPlugin]) plugin(context)
  entries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  apply(context)
  const mount = () => render(<PluginContextProvider context={context}><Root /></PluginContextProvider>)
  return { mount, mounted, unmounted, dismissDialog }
}

it('keeps plugin navigation and task-detail selection consistent in both layouts', async () => {
  setup('/tasks/task-1').mount()
  const menus = screen.getAllByRole('navigation', { name: '主导航' })
  expect(menus).toHaveLength(2)
  expect(within(menus[0]).getAllByRole('link').map(link => link.textContent)).toEqual(['工作台', '任务库', '工作流', '扩展'])
  expect(within(menus[1]).getAllByRole('link').map(link => link.textContent)).toEqual(['工作台', '任务库', '工作流', '扩展'])
  expect(screen.queryByRole('link', { name: '设置' })).not.toBeInTheDocument()
  const settings = within(screen.getByRole('complementary')).getByRole('button', { name: '设置' })
  expect(settings).toHaveAttribute('aria-haspopup', 'dialog')
  expect(settings.closest('[aria-label="应用设置"]')).toContainElement(settings)
  expect(settings.textContent).toBe('')
  for (const menu of menus) expect(within(menu).getByRole('link', { name: '任务库' })).toHaveAttribute('aria-current', 'page')
  await userEvent.setup().click(settings)
  expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument()
  expect(screen.getAllByRole('navigation', { name: '主导航', hidden: true })).toHaveLength(2)
  expect(screen.getByRole('complementary', { hidden: true })).toBeInTheDocument()
})

it('keeps the task page mounted with its edited input while settings opens and closes', async () => {
  const { mount, mounted, unmounted, dismissDialog } = setup('/tasks/review?tab=translation')
  mount()
  const user = userEvent.setup()
  const input = screen.getByRole('textbox', { name: '任务笔记' })
  await user.type(input, '仍在编辑的校对内容')
  const trigger = within(screen.getByRole('complementary')).getByRole('button', { name: '设置' })
  await user.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '设置' })
  expect(input).toHaveValue('仍在编辑的校对内容')
  expect(input).toBeInTheDocument()
  expect(mounted).toHaveBeenCalledOnce()
  expect(unmounted).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: '关闭设置' }))
  expect(dismissDialog).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '任务笔记' })).toBe(input)
  expect(input).toHaveValue('仍在编辑的校对内容')
  expect(window.location.pathname + window.location.search).toBe('/tasks/review?tab=translation')
  expect(mounted).toHaveBeenCalledOnce()
  expect(unmounted).not.toHaveBeenCalled()
})

it('restores collapsed navigation immediately and keeps accessible labels and a compact language control', async () => {
  const { mount } = setup()
  const first = mount()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '收起侧边栏' }))
  expect(window.localStorage.getItem('youdub-sidebar')).toBe('collapsed')
  const sidebar = screen.getByRole('complementary')
  expect(within(sidebar).getByRole('combobox', { name: '界面语言: 中文' })).toBeInTheDocument()
  expect(within(sidebar).getByRole('button', { name: '新建任务' })).toBeInTheDocument()
  expect(within(sidebar).getByRole('link', { name: '工作台' })).toBeInTheDocument()
  first.unmount()
  mount()
  expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '收起侧边栏' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '展开侧边栏' }))
  expect(window.localStorage.getItem('youdub-sidebar')).toBe('expanded')
  expect(within(screen.getByRole('complementary')).getByRole('group', { name: '界面语言' })).toBeInTheDocument()
})
