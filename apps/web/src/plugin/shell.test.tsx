import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ListVideo, Settings2, Sparkles } from 'lucide-react'
import { PluginContextProvider, type RouteEntry, type SlotMap } from './sdk'
import { apply } from './builtin/shell'

afterEach(() => { cleanup(); window.localStorage.clear() })

function setup(path = '/') {
  let current = path
  const listeners = new Set<() => void>()
  const snapshot = { status: 'authenticated' as const }
  const routes: RouteEntry[] = [
    { id: 'studio', path: '/', component: () => <h1>主页</h1>, access: 'authenticated' },
    { id: 'library', path: '/tasks', component: () => <h1>任务</h1>, access: 'authenticated' },
    { id: 'detail', path: '/tasks/:id', component: () => <h1>任务详情</h1>, access: 'authenticated' },
    { id: 'settings', path: '/settings', component: () => <h1>设置页</h1>, access: 'authenticated' },
    { id: 'extra', path: '/extra', component: () => <h1>扩展页</h1>, access: 'authenticated' },
  ]
  const entries = [
    { id: 'studio', routeId: 'studio', label: '工作台', icon: Sparkles },
    { id: 'library', routeId: 'library', label: '任务库', icon: ListVideo },
    { id: 'settings', routeId: 'settings', label: '设置', icon: Settings2 },
    { id: 'extra', routeId: 'extra', label: '扩展' },
  ]
  let Root!: ComponentType
  const context = {
    session: { subscribe: () => () => {}, getSnapshot: () => snapshot, logout: vi.fn() },
    navigation: {
      subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      getSnapshot: () => current,
      href: (id: string) => routes.find((route) => route.id === id)!.path,
      push: (next: string) => { current = next; listeners.forEach((listener) => listener()) },
    },
    slots: { subscribe: () => () => {}, getSnapshot: () => 0,
      list: (slot: string) => slot === 'shell.routes' ? routes : slot === 'shell.navigation' ? entries : [],
      register: (slot: string, entry: SlotMap['root']) => { if (slot === 'root') Root = entry.component; return () => {} },
    },
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  const mount = () => render(<PluginContextProvider context={context}><Root /></PluginContextProvider>)
  return { mount }
}

it('keeps plugin navigation and task-detail selection consistent in both layouts', async () => {
  setup('/tasks/task-1').mount()
  const menus = screen.getAllByRole('navigation', { name: '主导航' })
  expect(menus).toHaveLength(2)
  for (const menu of menus) {
    expect(within(menu).getAllByRole('link').map((link) => link.textContent)).toEqual(['工作台', '任务库', '设置', '扩展'])
    expect(within(menu).getByRole('link', { name: '任务库' })).toHaveAttribute('aria-current', 'page')
  }
  await userEvent.setup().click(within(menus[1]).getByRole('link', { name: '设置' }))
  expect(screen.getByRole('heading', { name: '设置页' })).toBeInTheDocument()
  for (const menu of menus) expect(within(menu).getByRole('link', { name: '设置' })).toHaveAttribute('aria-current', 'page')
  await userEvent.setup().click(within(menus[1]).getByRole('link', { name: '扩展' }))
  expect(screen.getByRole('heading', { name: '扩展页' })).toBeInTheDocument()
})

it('restores collapsed navigation immediately and keeps accessible labels and a compact language control', async () => {
  const { mount } = setup()
  const first = mount()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '收起侧边栏' }))
  expect(window.localStorage.getItem('youdub-sidebar')).toBe('collapsed')
  expect(screen.getByRole('combobox', { name: '界面语言: 中文' })).toBeInTheDocument()
  const sidebar = screen.getByRole('complementary')
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
