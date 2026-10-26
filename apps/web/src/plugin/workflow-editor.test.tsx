import { WorkflowsPage, WorkflowPage } from '../../../harness/src/frontend/workflow-pages'
import { useFeatures } from '../../../harness/src/frontend/runtime'
import { TestFeatureProvider, type TestContext } from './test-bindings'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider } from '@/test/language-provider'
import { type NodeTypeDefinition, type WorkflowDocument, type WorkflowDocumentRecord } from './sdk'
import { GraphStudio as GraphStudioView } from './builtin/workflows'
import { bindTestComponent } from './test-bindings'
const GraphStudio = bindTestComponent(GraphStudioView, ['draftStore', 'request', 'navigate', 'useQuery', 'useSlot', 'useWorkflowDocuments', 'useWorkflowResources'])
import { serializeWorkflowEdits, workflowDrafts, workflowViews } from './builtin/workflow-utils'
import { nodeDescriptors } from '../../../../packages/builtin/src/node-contracts'
import dubbingTemplate from '../../../../packages/builtin/src/workflow-templates/source-clone-dubbing.json'

vi.mock('./builtin/workflow-canvas', () => ({
  WorkflowCanvas: ({ document, fitOnLoad, onReady, onOpen, onSelect, onChange, addNodeRef }: {
    document: WorkflowDocument; fitOnLoad: boolean; onReady?(): void; onOpen(id: string): void; onSelect?(id: string): void; onChange(document: WorkflowDocument): void
    addNodeRef?: RefObject<((type: NodeTypeDefinition) => void) | null>
  }) => {
    const ready = useRef(onReady)
    useEffect(() => { ready.current?.() }, [])
    useEffect(() => { if (addNodeRef) addNodeRef.current = (type) => onChange({ ...document, nodes: [...document.nodes, { id: 'added', type: type.type, typeVersion: type.version, provider: { id: type.providerId }, config: {}, autoContinue: true }] }) }, [addNodeRef, document, onChange])
    return <div><button onClick={() => onSelect?.('$inputs')}>选择输入节点</button><button onClick={() => onSelect?.('$outputs')}>选择输出节点</button><output data-testid="canvas-view">{fitOnLoad ? 'fit' : 'preserved'}</output>{document.nodes.map((node) => <div key={node.id}><button onClick={() => onSelect?.(node.id)}>选择 {node.id}</button><button onClick={() => onOpen(node.id)}>详情 {node.id}</button></div>)}</div>
  },
}))
vi.mock('./builtin/workflow-run', () => ({
  WorkflowRun: ({ onLockChange, onStarted }: { onLockChange?(locked: boolean): void; onStarted?(): void }) => {
    const { navigate } = useFeatures()
    useEffect(() => { onLockChange?.(false) }, [onLockChange])
    return <section aria-label="运行表单"><button onClick={() => onLockChange?.(true)}>模拟提交</button><button onClick={() => onLockChange?.(false)}>清理提交</button><button onClick={() => { onStarted?.(); navigate('/workflows') }}>提交成功</button></section>
  },
}))
vi.mock('./builtin/workflow-rerun', () => ({ WorkflowRerun: () => <div>重跑表单</div> }))

const type: NodeTypeDefinition = { type: 'test.node', version: '1', providerId: 'test', operation: 'test', label: '测试节点', category: 'internal.category', provider: { id: 'test', label: '测试服务', operations: [] }, inputs: [], outputs: [], configSchema: { type: 'object', properties: { language: { type: 'string', title: '语言' } } }, defaults: {} }
const document: WorkflowDocument = { format: 'youdub.workflow', formatVersion: 1, id: 'example', title: '测试工作流', nodes: [{ id: 'node', type: type.type, typeVersion: '1', provider: { id: 'test' }, config: {}, autoContinue: true }], edges: [], inputs: [], outputs: [], presentation: { positions: {}, viewport: { x: 10, y: 20, zoom: 0.7 } } }
const record: WorkflowDocumentRecord = { id: 'example', revision: 1, document, origin: 'user' }
function mount(path = '/workflows/example', options: { record?: WorkflowDocumentRecord; empty?: boolean; studio?: boolean; types?: NodeTypeDefinition[] } = {}) {
  const current = structuredClone(options.record ?? record)
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v2/node-types') return { items: options.types ?? [type] }
    if (url.startsWith('/api/v2/workflow-documents?')) return { items: options.empty ? [] : [current], hasMore: false }
    if (url.endsWith('/validate')) return { valid: true, diagnostics: [] }
    if (init?.method === 'PUT' || init?.method === 'POST') return { ...current, revision: 2, document: JSON.parse(init.body as string).document }
    return current
  })
  const blockers = new Set<(path: string) => Promise<boolean>>()
  let changePath: (path: string) => void = () => {}
  const navigate = async (next: string) => {
    for (const block of blockers) if (!await block(next)) return
    window.history.replaceState(null, '', next); changePath(next)
  }
  const push = vi.fn((next: string) => { void navigate(next) })
  const context = { apiClient: { request }, navigation: { push, block: (block: (path: string) => Promise<boolean>) => { blockers.add(block); return () => blockers.delete(block) } },
    slots: { subscribe: () => () => {}, getSnapshot: () => 0, list: () => [] },
    effect: (effect: () => unknown) => effect(),
  } as unknown as TestContext
  window.history.replaceState(null, '', path)
  function Host() {
    const [location, setLocation] = useState(path)
    changePath = setLocation
    const segments = location.split('?')[0].split('/').filter(Boolean)
    const route = segments.length > 3 ? 'workflow-node' : segments.length > 1 ? 'workflow-editor' : 'workflows'
    const Page = route === 'workflows' ? WorkflowsPage : WorkflowPage
    return <TestFeatureProvider context={context}><LanguageProvider>{options.studio ? <GraphStudio /> : <Page key={location} params={{ id: segments[1], nodeId: segments[3] }} />}</LanguageProvider></TestFeatureProvider>
  }
  render(<Host />)
  return { request, push, navigate }
}
afterEach(() => { cleanup(); workflowDrafts.clear(); workflowViews.clear(); window.localStorage.clear(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks() })

it('rejects an unsupported import with recovery guidance and preserves the original diagnostic', async () => {
  const { request } = mount('/workflows')
  await screen.findByRole('button', { name: '导入' })
  const file = new File(['{}'], 'invalid.workflow.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => '{}' })
  fireEvent.change(window.document.querySelector('input[type="file"]')!, { target: { files: [file] } })
  expect(await screen.findByRole('alert')).toHaveTextContent('文件格式不受支持，请选择从 YouDub 导出的工作流 JSON 文件。')
  expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: '诊断详情' }))
  expect(screen.getByText('Unsupported workflow file. Expected youdub.workflow version 1.')).toBeVisible()
})

it('shows built-in names in Japanese and saves a copy with the displayed names and custom port edits', async () => {
  window.localStorage.setItem('youdub-ui-language', 'ja')
  const template = { ...structuredClone(dubbingTemplate), id: 'youdub.dubbing', title: '视频配音' } as WorkflowDocument
  const original = structuredClone(template)
  const { request } = mount('/workflows/youdub.dubbing', { record: { id: template.id, revision: 0, origin: 'builtin', document: template } })
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: '動画の吹き替え' })).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: '入力' }))
  expect(screen.getByLabelText('入力名')).toHaveValue('動画')
  expect(screen.queryByLabelText('出力名')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '出力' }))
  expect(screen.queryByLabelText('入力名')).not.toBeInTheDocument()
  const outputs = screen.getAllByLabelText('出力名')
  expect(outputs[0]).toHaveValue('吹き替え動画')
  expect(outputs[1]).toHaveValue('吹き替え音声')
  await user.clear(outputs[1]); await user.type(outputs[1], 'My narration')
  await user.click(screen.getByRole('button', { name: 'コピーを保存' }))
  const saved = request.mock.calls.find(([url, init]) => url === '/api/v2/workflow-documents' && init?.method === 'POST')
  const copy = JSON.parse(String(saved?.[1]?.body)).document as WorkflowDocument
  expect(copy.id).not.toBe(template.id)
  expect(copy.title).toBe('動画の吹き替え · コピー')
  expect(copy.inputs[0].label).toBe('動画')
  expect(copy.outputs.map(port => port.label)).toEqual(['吹き替え動画', 'My narration'])
  expect(template).toEqual(original)
})

it('preserves custom workflow and port names when the interface language changes', async () => {
  window.localStorage.setItem('youdub-ui-language', 'ja')
  const custom = { ...structuredClone(dubbingTemplate), id: 'my-dubbing', title: '我的配音' } as WorkflowDocument
  mount('/workflows/my-dubbing', { record: { id: custom.id, revision: 1, origin: 'user', document: custom } })
  expect(await screen.findByRole('heading', { name: '我的配音' })).toBeInTheDocument()
  await userEvent.setup().click(await screen.findByRole('button', { name: '入力' }))
  expect(screen.getByLabelText('入力名')).toHaveValue('视频')
  await userEvent.setup().click(screen.getByRole('button', { name: '出力' }))
  expect(screen.getAllByLabelText('出力名').map(input => (input as HTMLInputElement).value)).toEqual(['配音视频', '配音音频'])
})

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

it.each(['添加节点', '输入', '输出', '运行'])('returns focus to %s after closing its panel with the button or Escape', async (name) => {
  mount()
  const user = userEvent.setup()
  const trigger = await screen.findByRole('button', { name })
  await user.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(window.document.getElementById(trigger.getAttribute('aria-controls')!)).toContainElement(screen.getByRole('button', { name: '关闭面板' }))
  await user.click(screen.getByRole('button', { name: '关闭面板' }))
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await user.keyboard('{Enter}')
  const close = screen.getByRole('button', { name: '关闭面板' })
  close.focus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('button', { name: '关闭面板' })).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('starts a new workflow as a draft with the node library open', async () => {
  mount('/workflows/new')
  await screen.findByText('草稿')
  expect(screen.queryByText('已保存')).not.toBeInTheDocument()
  expect(screen.getByLabelText('搜索节点')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '运行' })).toBeDisabled()
})

it('adds the existing download node and saves its proxy port through the generic settings editor', async () => {
  const download: NodeTypeDefinition = { ...nodeDescriptors.download, providerId: 'youdub.download', operation: 'download', provider: { id: 'youdub.download', label: 'YouTube / B 站', operations: [] }, outputs: [{ name: 'video', kind: 'artifact', schemaId: 'video/mp4/v1', required: true }] }
  const { request } = mount('/workflows/new', { types: [download] })
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /下载视频/ }))
  await user.click(screen.getByRole('button', { name: '详情 added' }))
  const proxy = await screen.findByRole('spinbutton', { name: '本机 HTTP 代理端口（0 为直连）' })
  expect(proxy).toHaveAttribute('step', '1')
  fireEvent.change(proxy, { target: { value: '7897' } })
  await user.click(screen.getByRole('button', { name: '保存' }))
  const saved = request.mock.calls.find(([url, init]) => url === '/api/v2/workflow-documents' && init?.method === 'POST')
  expect(JSON.parse(String(saved?.[1]?.body)).document.nodes[0].config.proxyPort).toBe(7897)
})

it('keeps viewport and undo history when opening full settings and returning', async () => {
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '工作流名称' }))
  const name = screen.getByRole('textbox', { name: '工作流名称' })
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
  expect(screen.queryByRole('heading', { name: '重命名' })).not.toBeInTheDocument()
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
  await user.click(await screen.findByRole('button', { name: '工作流名称' }))
  await user.type(screen.getByRole('textbox', { name: '工作流名称' }), '修改')
  await user.click(screen.getByRole('button', { name: '运行' }))
  await user.click(screen.getByRole('button', { name: '模拟提交' }))
  await user.click(screen.getByRole('button', { name: '清理提交' }))
  expect(screen.getByLabelText('工作流名称')).toBeEnabled()
  void navigate('/workflows')
  await screen.findByRole('dialog', { name: '有未保存的修改' })
  expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus()
  await user.keyboard('{Tab}')
  expect(screen.getByRole('button', { name: '保存并离开' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '清理提交' })).toHaveFocus()
  expect(screen.getByRole('heading', { name: '测试工作流修改' })).toBeInTheDocument()
})

it('shows an empty workflow selection without an endless loading message', async () => {
  mount('/', { studio: true, empty: true })
  await screen.findByText('暂无工作流')
  expect(screen.queryByText('加载工作流…')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '新建工作流' })).toHaveAttribute('href', '/workflows/new')
})


it('does not retain a clean document over a newer server revision', async () => {
  mount()
  await screen.findByLabelText('工作流名称')
  expect(workflowDrafts.has(record.id)).toBe(false)
  cleanup()
  mount('/workflows/example', { record: { ...record, revision: 2, document: { ...document, title: '服务端新版' } } })
  expect(await screen.findByRole('heading', { name: '服务端新版' })).toBeInTheDocument()
})

it('keeps a dirty draft on revision conflict and explicitly identifies its older base', async () => {
  workflowDrafts.set(record.id, { document: { ...document, title: '未保存修改' }, saved: serializeWorkflowEdits(document), revision: 1, origin: 'user' })
  mount('/workflows/example', { record: { ...record, revision: 2, document: { ...document, title: '服务端新版' } } })
  expect(await screen.findByRole('heading', { name: '未保存修改' })).toBeInTheDocument()
  expect(screen.getByText('此草稿基于旧版本工作流，可另存副本保留修改。')).toBeInTheDocument()
})


it('shows a compact title and commits or cancels inline renaming', async () => {
  mount()
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: '测试工作流' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: '工作流名称' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '工作流名称' }))
  const input = screen.getByRole('textbox', { name: '工作流名称' })
  await user.clear(input)
  await user.type(input, '修改名称{Enter}')
  expect(screen.getByRole('heading', { name: '修改名称' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '工作流名称' }))
  await user.type(screen.getByRole('textbox', { name: '工作流名称' }), '取消{Escape}')
  expect(screen.getByRole('heading', { name: '修改名称' })).toBeInTheDocument()
})

it('opens only the selected boundary node settings and keeps changes independent', async () => {
  const template = structuredClone(dubbingTemplate) as WorkflowDocument
  mount('/workflows/example', { record: { ...record, document: template } })
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '选择输入节点' }))
  expect(screen.getByRole('heading', { name: '输入' })).toBeInTheDocument()
  expect(screen.queryByLabelText('输出名称')).not.toBeInTheDocument()
  const input = screen.getByLabelText('输入名称')
  await user.clear(input); await user.type(input, '原始视频')
  await user.click(screen.getByRole('button', { name: '选择输出节点' }))
  expect(screen.getByRole('heading', { name: '输出' })).toBeInTheDocument()
  expect(screen.queryByLabelText('输入名称')).not.toBeInTheDocument()
  expect(screen.getAllByLabelText('输出名称')).toHaveLength(template.outputs.length)
  await user.click(screen.getByRole('button', { name: '选择输入节点' }))
  expect(screen.getByLabelText('输入名称')).toHaveValue('原始视频')
})
