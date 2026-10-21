import type { Context } from 'cordis'
import { useEffect, useRef, useState } from 'react'
import type { ComponentType, RefObject } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/lib/i18n'
import { PluginContextProvider, useClient, type NodeTypeDefinition, type RouteEntry, type RouteProps, type WorkflowDocument, type WorkflowDocumentRecord } from './sdk'
import { apply, GraphStudio } from './builtin/workflows'
import { workflowDrafts } from './builtin/workflow-utils'

vi.mock('./builtin/workflow-canvas', () => ({
  WorkflowCanvas: ({ document, fitOnLoad, onReady, onOpen, onSelect, onChange, addNodeRef }: {
    document: WorkflowDocument; fitOnLoad: boolean; onReady?(): void; onOpen(id: string): void; onSelect?(id: string): void; onChange(document: WorkflowDocument): void
    addNodeRef?: RefObject<((type: NodeTypeDefinition) => void) | null>
  }) => {
    const ready = useRef(onReady)
    useEffect(() => { ready.current?.() }, [])
    useEffect(() => { if (addNodeRef) addNodeRef.current = (type) => onChange({ ...document, nodes: [...document.nodes, { id: 'added', type: type.type, typeVersion: type.version, provider: { id: type.providerId }, config: {}, autoContinue: true }] }) }, [addNodeRef, document, onChange])
    return <div><output data-testid="canvas-view">{fitOnLoad ? 'fit' : 'preserved'}</output>{document.nodes.map((node) => <div key={node.id}><button onClick={() => onSelect?.(node.id)}>选择 {node.id}</button><button onClick={() => onOpen(node.id)}>详情 {node.id}</button></div>)}</div>
  },
}))
vi.mock('./builtin/workflow-run', () => ({
  WorkflowRun: ({ onLockChange, onStarted }: { onLockChange?(locked: boolean): void; onStarted?(): void }) => {
    const { navigation } = useClient()
    useEffect(() => { onLockChange?.(false) }, [onLockChange])
    return <section aria-label="运行表单"><button onClick={() => onLockChange?.(true)}>模拟提交</button><button onClick={() => onLockChange?.(false)}>清理提交</button><button onClick={() => { onStarted?.(); navigation.push('/workflows') }}>提交成功</button></section>
  },
}))
vi.mock('./builtin/workflow-rerun', () => ({ WorkflowRerun: () => <div>重跑表单</div> }))

const type: NodeTypeDefinition = { type: 'test.node', version: '1', providerId: 'test', operation: 'test', label: '测试节点', category: 'internal.category', provider: { id: 'test', label: '测试服务', operations: [] }, inputs: [], outputs: [], configSchema: { type: 'object', properties: { language: { type: 'string', title: '语言' } } }, defaults: {} }
const document: WorkflowDocument = { format: 'youdub.workflow', formatVersion: 1, id: 'example', title: '测试工作流', nodes: [{ id: 'node', type: type.type, typeVersion: '1', provider: { id: 'test' }, config: {}, autoContinue: true }], edges: [], inputs: [], outputs: [], presentation: { positions: {}, viewport: { x: 10, y: 20, zoom: 0.7 } } }
const record: WorkflowDocumentRecord = { id: 'example', revision: 1, document, origin: 'user' }
function mount(path = '/workflows/example', options: { record?: WorkflowDocumentRecord; empty?: boolean; studio?: boolean } = {}) {
  const current = structuredClone(options.record ?? record)
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v2/node-types') return { items: [type] }
    if (url.startsWith('/api/v2/workflow-documents?')) return { items: options.empty ? [] : [current], hasMore: false }
    if (url.endsWith('/validate')) return { valid: true, diagnostics: [] }
    if (init?.method === 'PUT' || init?.method === 'POST') return { ...current, revision: 2, document: JSON.parse(init.body as string).document }
    return current
  })
  const routes = new Map<string, RouteEntry>()
  const blockers = new Set<(path: string) => Promise<boolean>>()
  let changePath: (path: string) => void = () => {}
  const navigate = async (next: string) => {
    for (const block of blockers) if (!await block(next)) return
    window.history.replaceState(null, '', next); changePath(next)
  }
  const push = vi.fn((next: string) => { void navigate(next) })
  const context = { apiClient: { request }, navigation: { push, replace: push, block: (block: (path: string) => Promise<boolean>) => { blockers.add(block); return () => blockers.delete(block) } },
    slots: { register: (slot: string, entry: RouteEntry) => { if (slot === 'shell.routes') routes.set(entry.id, entry); return () => {} }, subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] },
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context
  apply(context)
  window.history.replaceState(null, '', path)
  function Host() {
    const [location, setLocation] = useState(path)
    changePath = setLocation
    const segments = location.split('?')[0].split('/').filter(Boolean)
    const route = segments.length > 3 ? 'workflow-node' : segments.length > 1 ? 'workflow-editor' : 'workflows'
    const Page = routes.get(route)!.component as ComponentType<RouteProps>
    return <PluginContextProvider context={context}><LanguageProvider>{options.studio ? <GraphStudio /> : <Page key={location} params={{ id: segments[1], nodeId: segments[3] }} />}</LanguageProvider></PluginContextProvider>
  }
  render(<Host />)
  return { request, push, navigate }
}
afterEach(() => { cleanup(); workflowDrafts.clear(); window.localStorage.clear(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks() })

it('offers use and edit separately and opens use directly in the run panel', async () => {
  const { push } = mount('/workflows', { record: { ...record, origin: 'builtin', revision: 0 } })
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '使用' }))
  expect(push).toHaveBeenLastCalledWith('/workflows/example?run=1')
  await screen.findByRole('region', { name: '运行表单' })
  expect(screen.getByText('模板')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '保存副本' })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '另存为' })).not.toBeInTheDocument()
})

it('starts a new workflow as a draft with the node library open', async () => {
  mount('/workflows/new')
  await screen.findByText('草稿')
  expect(screen.queryByText('已保存')).not.toBeInTheDocument()
  expect(screen.getByLabelText('搜索节点')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '运行' })).toBeDisabled()
})

it('keeps viewport and undo history when opening full settings and returning', async () => {
  mount()
  const user = userEvent.setup()
  const name = await screen.findByLabelText('工作流名称')
  expect(screen.getByTestId('canvas-view')).toHaveTextContent('fit')
  await user.clear(name); await user.type(name, '重命名')
  await user.click(screen.getByRole('button', { name: '详情 node' }))
  await screen.findByRole('heading', { name: '测试节点' })
  expect(screen.queryByText('尚未运行')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '返回' }))
  await screen.findByTestId('canvas-view')
  expect(screen.getByTestId('canvas-view')).toHaveTextContent('preserved')
  expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '撤销' }))
  expect(screen.getByLabelText('工作流名称')).not.toHaveValue('重命名')
})

it('returns to the canvas after deleting a node in full settings and allows undo', async () => {
  mount('/workflows/example/nodes/node')
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '删除' }))
  await screen.findByTestId('canvas-view')
  expect(screen.queryByText('节点不存在。')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '详情 node' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '撤销' }))
  expect(screen.getByRole('button', { name: '详情 node' })).toBeInTheDocument()
})

it('reports validation success without switching to the run panel', async () => {
  mount()
  await userEvent.setup().click(await screen.findByRole('button', { name: '校验' }))
  await screen.findByText('校验通过')
  expect(screen.queryByRole('region', { name: '运行表单' })).not.toBeInTheDocument()
})

it('blocks navigation, editing and unload while a submission is unresolved, then allows its success route', async () => {
  const { navigate, request } = mount('/workflows/example?run=1')
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '模拟提交' }))
  expect(screen.getByLabelText('工作流名称')).toBeDisabled()
  expect(screen.getByRole('button', { name: '添加节点' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '关闭面板' })).toBeDisabled()
  await act(() => navigate('/workflows'))
  expect(screen.getByRole('region', { name: '运行表单' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  await user.keyboard('{Control>}s{/Control}')
  expect(request.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  await user.click(screen.getByRole('button', { name: '提交成功' }))
  await screen.findByRole('heading', { name: '工作流' })
})

it('keeps actual edits protected after a pending submission is cleared', async () => {
  const { navigate } = mount()
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText('工作流名称'), '修改')
  await user.click(screen.getByRole('button', { name: '运行' }))
  await user.click(screen.getByRole('button', { name: '模拟提交' }))
  await user.click(screen.getByRole('button', { name: '清理提交' }))
  expect(screen.getByLabelText('工作流名称')).toBeEnabled()
  void navigate('/workflows')
  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByLabelText('工作流名称')).toHaveValue('测试工作流修改')
})

it('shows an empty workflow selection without an endless loading message', async () => {
  mount('/', { studio: true, empty: true })
  await screen.findByText('暂无工作流')
  expect(screen.queryByText('加载工作流…')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '新建工作流' })).toHaveAttribute('href', '/workflows/new')
})
