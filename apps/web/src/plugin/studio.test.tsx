import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, type Catalog, type RouteProps, type SlotMap, type TaskView } from './sdk'
import { apply } from './builtin/studio'

const catalog: Catalog = { providers: [], workflows: [{ id: 'external.text', version: '2.0.0', label: 'Text workflow', inputs: [{ name: 'document', label: 'Document', acceptedMimeTypes: ['text/plain'], required: true }], configSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['upper', 'lower'] } }, required: ['mode'] }, defaults: { mode: 'upper' } }] }
afterEach(() => { cleanup(); window.localStorage.clear() })

it('submits declared input slots and preserves an uncertain creation ID until explicitly cleared', async () => {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return catalog
    if (path.startsWith('/api/v2/tasks?')) return { items: [], hasMore: false, limit: 12, offset: 0 }
    if (init?.method === 'DELETE') return undefined
    throw new Error('Connection interrupted')
  })
  let Page!: ComponentType<RouteProps>
  const context = {
    apiClient: { request }, navigation: { push: vi.fn() },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] },
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  const input = await screen.findByLabelText('Document *')
  const user = userEvent.setup()
  await user.upload(input, new File(['hello'], 'input.txt', { type: 'text/plain' }))
  expect((input as HTMLInputElement).files).toHaveLength(1)
  expect(screen.queryByLabelText('处理流程')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始处理' })).toHaveAttribute('type', 'submit')
  // jsdom does not connect user-event's FileList to native file validity.
  fireEvent.submit(input.closest('form')!)
  await screen.findByText('Connection interrupted')
  const first = request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as FormData
  const firstRequest = JSON.parse(first.get('request') as string)
  expect(firstRequest).toMatchObject({ workflowId: 'external.text', workflowVersion: '2.0.0', config: { mode: 'upper' } })
  expect((first.get('input.document') as File).name).toBe('input.txt')
  expect(first.has('file')).toBe(false)
  expect(input).toBeDisabled()
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2))
  const repeated = request.mock.calls.filter(([, init]) => init?.method === 'POST')[1][1]!.body as FormData
  expect(JSON.parse(repeated.get('request') as string).id).toBe(firstRequest.id)
  await user.click(screen.getByRole('button', { name: '清理本次导入' }))
  await waitFor(() => expect(input).toBeEnabled())
  expect(request).toHaveBeenCalledWith(`/api/v2/imports/${firstRequest.id}`, { method: 'DELETE' })
})

it('locks workflow selection while a submitted import still needs reconciliation', async () => {
  const multiple = { ...catalog, workflows: [...catalog.workflows, { ...catalog.workflows[0], id: 'another', label: 'Another workflow' }] }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return multiple
    if (path.startsWith('/api/v2/tasks?')) return { items: [], hasMore: false, limit: 12, offset: 0 }
    if (init?.method === 'DELETE') return undefined
    throw new Error('Connection interrupted')
  })
  let Page!: ComponentType<RouteProps>
  const context = { apiClient: { request }, navigation: { push: vi.fn() },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] }, effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  const input = await screen.findByLabelText('Document *')
  const user = userEvent.setup()
  await user.upload(input, new File(['hello'], 'input.txt', { type: 'text/plain' }))
  fireEvent.submit(input.closest('form')!)
  await screen.findByText('Connection interrupted')
  expect(screen.getByLabelText('处理流程')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '清理本次导入' }))
  await waitFor(() => expect(screen.getByLabelText('处理流程')).toBeEnabled())
  await user.selectOptions(screen.getByLabelText('处理流程'), 'another')
  expect(screen.getByLabelText('Document *')).toHaveValue('')
})

function mount(request: ReturnType<typeof vi.fn>) {
  let Page!: ComponentType<RouteProps>
  const push = vi.fn()
  const context = { apiClient: { request }, navigation: { push },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes') Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] }, effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  render(<PluginContextProvider context={context}><LanguageProvider><Page params={{}} /></LanguageProvider></PluginContextProvider>)
  return push
}

it('shows the selected file and clears it before allowing a fresh selection', async () => {
  mount(vi.fn(async (path: string) => path === '/api/v2/catalog' ? catalog : { items: [], hasMore: false, limit: 12, offset: 0 }))
  const user = userEvent.setup()
  const input = await screen.findByLabelText('Document *')
  expect(screen.getByRole('button', { name: '开始处理' })).toBeDisabled()
  await user.upload(input, new File(['hello'], 'first.txt', { type: 'text/plain' }))
  expect(screen.getByText('first.txt')).toBeInTheDocument()
  expect(screen.getByText(/5 B/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始处理' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '移除 first.txt' }))
  expect(screen.queryByText('first.txt')).not.toBeInTheDocument()
  expect(input).toHaveValue('')
  expect(screen.getByRole('button', { name: '开始处理' })).toBeDisabled()
  await user.upload(input, new File(['again'], 'second.txt', { type: 'text/plain' }))
  expect(screen.getByText('second.txt')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '开始处理' })).toBeEnabled()
})

it('keeps active tasks separate from recent results and links to their detail pages', async () => {
  const task = (id: string, status: TaskView['status']): TaskView => ({
    id, status, attempt: 1, sourceName: `${id}.mp4`, createdAt: '2026-10-09T01:00:00Z',
    workflowId: 'external.text', workflowVersion: '2.0.0', config: {}, steps: [], outputs: [], allowedActions: [], cover: { url: `/cover/${id}.jpg` },
  })
  const items = [task('running', 'running'), task('completed', 'succeeded'), task('failed', 'failed'), task('cancelling', 'cancelling')]
  items[0].steps = [{ id: 'synthesize', label: '生成配音', status: 'running', progress: null }, { id: 'export', label: '导出', status: 'pending', progress: null }]
  const push = mount(vi.fn(async (path: string) => path === '/api/v2/catalog' ? catalog : { items, hasMore: false, limit: 12, offset: 0 }))
  const active = await screen.findByRole('region', { name: '进行中' })
  const recent = screen.getByRole('region', { name: '最近任务' })
  expect(active).toHaveTextContent('running.mp4')
  expect(active).toHaveTextContent('cancelling.mp4')
  expect(active).not.toHaveTextContent('completed.mp4')
  expect(active).toHaveTextContent('生成配音')
  expect(active).toHaveTextContent('已完成 0/2 步')
  expect(active.querySelector('img')).toHaveAttribute('src', '/cover/running.jpg')
  expect(active.querySelector('progress')).toBeNull()
  expect(recent).toHaveTextContent('completed.mp4')
  expect(recent).toHaveTextContent('failed.mp4')
  expect(recent).not.toHaveTextContent('running.mp4')
  expect(recent.querySelector('img')).toHaveAttribute('src', '/cover/completed.jpg')
  await userEvent.setup().click(screen.getByRole('link', { name: /completed.mp4/ }))
  expect(push).toHaveBeenCalledWith('/tasks/completed')
})
