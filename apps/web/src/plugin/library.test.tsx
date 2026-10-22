import type { Context } from 'cordis'
import type { ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, type Catalog, type RouteProps, type SlotMap, type TaskView } from './sdk'
import { apply } from './builtin/library'

const workflow = { id: 'external.text', version: '2.0.0', label: 'Text workflow', inputs: [], configSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['upper', 'lower'] } }, required: ['mode'] }, defaults: { mode: 'upper' } }
const catalog: Catalog = { providers: [], workflows: [workflow, { ...workflow, id: 'another', label: 'Another workflow' }] }
const task: TaskView = { id: 'original', attempt: 2, status: 'succeeded', sourceName: 'document.txt', createdAt: '2026-10-09T00:00:00Z', workflowId: workflow.id, workflowVersion: workflow.version, config: { mode: 'upper' }, steps: [], outputs: [], allowedActions: ['rerun', 'delete'] }
function mount(request: ReturnType<typeof vi.fn>, route = 'task-detail') {
  const push = vi.fn()
  let Page!: ComponentType<RouteProps>
  const context = { apiClient: { request }, navigation: { push },
    slots: { register: (slot: string, entry: SlotMap['shell.routes']) => { if (slot === 'shell.routes' && entry.id === route) Page = entry.component; return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] },
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  const show = () => render(<PluginContextProvider context={context}><LanguageProvider><Page params={{ id: task.id }} /></LanguageProvider></PluginContextProvider>)
  const view = show()
  return Object.assign(push, { unmount: view.unmount, show })
}
afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks() })

it('shows the running step and completed step count without inventing total progress', async () => {
  const current: TaskView = { ...task, status: 'running', sourceName: 'very-long-video-title-without-any-spaces-to-keep-the-status-readable.mp4', cover: { url: '/cover/current.jpg' }, steps: [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `done-${index}`, label: 'Done', status: 'completed', progress: 1 })),
    { id: 'synthesize', label: '生成配音', status: 'running', progress: null },
    { id: 'align', label: '字幕对齐', status: 'pending', progress: null },
    { id: 'export', label: '导出', status: 'pending', progress: null },
  ] }
  mount(vi.fn(async () => ({ items: [current], hasMore: false, limit: 20, offset: 0 })), 'library')
  const heading = await screen.findByRole('heading', { name: current.sourceName })
  expect(heading).toHaveAttribute('title', current.sourceName)
  expect(screen.getByText('生成配音')).toBeInTheDocument()
  expect(screen.getByText('已完成 5/8 步')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByText(workflow.id)).not.toBeInTheDocument()
  expect(document.querySelector('img')).toHaveAttribute('src', '/cover/current.jpg')
})

it('filters cancelling tasks and distinguishes an empty filter from an empty library', async () => {
  const request = vi.fn(async () => ({ items: [], hasMore: false, limit: 20, offset: 0 }))
  mount(request, 'library')
  await screen.findByText('还没有任务')
  await userEvent.setup().click(screen.getByLabelText('任务状态'))
  await userEvent.setup().click(screen.getByRole('menuitem', { name: '正在取消' }))
  await screen.findByText('没有符合此状态的任务')
  expect(screen.queryByText('还没有任务')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledWith('/api/v2/tasks?limit=20&offset=0&status=cancelling', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

it('keeps rerun state until the user checks or clears the failed import, then allows changed configuration', async () => {
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v2/catalog') return catalog
    if (path === '/api/v2/tasks/original') return task
    if (init?.method === 'DELETE') return undefined
    if (init?.method === 'POST') throw new Error('Connection interrupted')
    throw new Error('Task not found')
  })
  mount(request)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '重新生成' }))
  const workflowSelect = await screen.findByLabelText('处理流程')
  await user.click(await screen.findByRole('button', { name: '创建任务' }))
  await screen.findByText(/Connection interrupted/)
  const first = JSON.parse(request.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body as string)
  expect(workflowSelect).toBeDisabled()
  expect(screen.getByLabelText('mode *')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '查询创建结果' }))
  await screen.findByText(/Task not found/)
  expect(request).toHaveBeenCalledWith(`/api/v2/tasks/${first.id}`)
  await user.click(screen.getByRole('button', { name: '清理本次导入' }))
  await waitFor(() => expect(workflowSelect).toBeEnabled())
  expect(request).toHaveBeenCalledWith(`/api/v2/imports/${first.id}`, { method: 'DELETE' })
  await user.click(screen.getByLabelText('mode *'))
  await user.click(screen.getByRole('menuitem', { name: 'lower' }))
  await user.click(screen.getByRole('button', { name: '创建任务' }))
  const second = JSON.parse(request.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)![1]!.body as string)
  expect(second.id).not.toBe(first.id)
  expect(second.config).toEqual({ mode: 'lower' })
})

it('releases audio reads before allowing task deletion', async () => {
  const request = vi.fn(async () => ({ ...task, outputs: [{ id: 'audio', label: 'Audio', mimeType: 'audio/wav', url: '/api/v2/tasks/original/files/audio' }] }))
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  mount(request)
  await screen.findByRole('button', { name: '删除任务' })
  const audio = document.querySelector('audio')!
  Object.defineProperty(audio, 'paused', { value: false })
  Object.defineProperty(audio, 'networkState', { value: 2 })
  await userEvent.setup().click(screen.getByRole('button', { name: '删除任务' }))
  expect(audio.getAttribute('src')).toBeNull()
  expect(pause).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledOnce()
})

it('shows graph results before a collapsed step list and uses the workflow title', async () => {
  const graph = { format: 'youdub.workflow', formatVersion: 1, id: 'graph', title: '字幕校对', nodes: [], edges: [], inputs: [], outputs: [], presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } } }
  mount(vi.fn(async () => ({ ...task, sourceName: 'youdub.graph', workflowId: 'youdub.graph', graphSnapshot: graph, outputs: [{ id: 'subtitle', label: '中文字幕', mimeType: 'application/x-subrip', url: '/subtitle.srt' }], steps: [{ id: 'translate', label: '翻译', status: 'completed', progress: 1 }] })))
  await screen.findByRole('heading', { name: '字幕校对', level: 1 })
  expect(screen.queryByText(/youdub.graph/)).not.toBeInTheDocument()
  const results = screen.getByRole('heading', { name: '生成文件' })
  const steps = screen.getByText(/步骤列表/).closest('details')!
  expect(steps.open).toBe(false)
  expect(results.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await userEvent.setup().click(screen.getByText(/步骤列表/))
  expect(steps.open).toBe(true)
  expect(screen.getByRole('link', { name: '翻译' })).toHaveAttribute('href', '/tasks/original/nodes/translate')
})


it('restores an unresolved rerun on return and does not navigate after its source view closes', async () => {
  let complete!: (value: TaskView) => void
  const request = vi.fn(async (path: string) => {
    if (path === '/api/v2/catalog') return catalog
    if (path.endsWith('/rerun')) return new Promise<TaskView>(resolve => { complete = resolve })
    return task
  })
  const push = mount(request), user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '重新生成' }))
  await user.click(await screen.findByLabelText('mode *'))
  await user.click(screen.getByRole('menuitem', { name: 'lower' }))
  await user.click(screen.getByRole('button', { name: '创建任务' }))
  await waitFor(() => expect(complete).toBeDefined())
  push.unmount()
  await act(async () => complete({ ...task, id: 'new-task' }))
  expect(push).not.toHaveBeenCalled()
  push.show()
  expect(await screen.findByLabelText('mode *')).toHaveTextContent('lower')
  expect(screen.getByLabelText('mode *')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '查询创建结果' }))
  expect(push).toHaveBeenCalledWith('/tasks/new-task')
})
