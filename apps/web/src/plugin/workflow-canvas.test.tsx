import { createRef, useEffect, useRef } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProvider, useI18n } from '@/lib/i18n'
import type { NodeTypeDefinition, TaskStep, WorkflowDocument } from './contracts'
import { createNode, WorkflowCanvas } from './builtin/workflow-canvas'
import subtitlesTemplate from '../../../../packages/builtin/src/workflow-templates/reviewed-subtitles.json'

const flow = vi.hoisted(() => ({
  screenToFlowPosition: vi.fn(() => ({ x: 1200, y: -300 })),
  fitView: vi.fn<(options?: object) => Promise<boolean>>(async () => true), setViewport: vi.fn(async () => true),
  getNodesBounds: vi.fn(() => ({ x: -320, y: 0, width: 2000, height: 400 })),
  getViewport: vi.fn(() => ({ x: -500, y: 30, zoom: 0.75 })),
}))
vi.mock('@xyflow/react', () => ({
  Position: { Left: 'left', Right: 'right' }, Handle: () => null, Background: () => null,
  Controls: ({ fitViewOptions }: { fitViewOptions: object }) => <button onClick={() => flow.fitView(fitViewOptions)}>适应画布</button>,
  ReactFlow: ({ nodes, nodeTypes, onInit, children }: { nodes: { id: string; type: string; data: unknown; position: { x: number; y: number } }[]; nodeTypes: Record<string, React.ComponentType<Record<string, unknown>>>; onInit(value: unknown): void; children?: React.ReactNode }) => {
    const initialize = useRef(onInit)
    useEffect(() => { initialize.current(flow) }, [])
    return <div>{nodes.map((node) => { const Node = nodeTypes[node.type]; return <div key={node.id} data-testid={node.id} data-position={JSON.stringify(node.position)}><Node data={node.data} /></div> })}{children}</div>
  },
}))
const type: NodeTypeDefinition = { type: 'test.node', version: '1', providerId: 'test', operation: 'test', label: '测试节点', category: 'test', provider: { id: 'test', operations: [] }, inputs: [], outputs: [], configSchema: { type: 'object', properties: { language: { type: 'string', title: '语言', enum: ['zh', 'en'] } } }, defaults: { language: 'zh' }, ui: { quickFields: ['language'] } }
function graph(): WorkflowDocument { return { format: 'youdub.workflow', formatVersion: 1, id: 'graph', title: 'Graph', nodes: ['a', 'b', 'c'].map((id) => ({ id, type: type.type, typeVersion: '1', provider: { id: 'test' }, config: { language: 'zh' }, autoContinue: id === 'c' })), inputs: [], outputs: [], edges: [], presentation: { positions: {}, viewport: { x: -600, y: 50, zoom: 0.5 } } } }
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); window.localStorage.clear() })

it('new local nodes use automatic devices and remote nodes retain remote execution', () => {
  for (const devices of [['cpu'], ['cpu', 'cuda:0'], ['mps', 'cpu']]) {
    const definition = { ...type, provider: { ...type.provider, execution: 'local' as const, models: [{ id: 'model', devices }] } }
    expect(createNode(definition).provider).toEqual({ id: type.providerId, model: 'model', device: 'auto' })
    expect(createNode({ ...definition, provider: { ...definition.provider, execution: 'remote' } }).provider.device).toBe('remote')
  }
})

it('updates built-in canvas ports when switching languages without rewriting the workflow', async () => {
  const document = { ...structuredClone(subtitlesTemplate), id: 'youdub.subtitles', title: '字幕翻译', nodes: [], edges: [] } as WorkflowDocument
  const change = vi.fn()
  function LanguageSwitch() {
    const { setLanguage } = useI18n()
    return <><button onClick={() => setLanguage('ja')}>日本語</button><button onClick={() => setLanguage('en')}>English</button></>
  }
  render(<LanguageProvider><LanguageSwitch /><WorkflowCanvas document={document} types={[]} onChange={change} onOpen={() => {}} /></LanguageProvider>)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '日本語' }))
  expect(screen.getByTestId('$inputs')).toHaveTextContent('動画')
  expect(screen.getByTestId('$outputs')).toHaveTextContent('原文字幕')
  expect(screen.getByTestId('$outputs')).toHaveTextContent('翻訳字幕')
  await user.click(screen.getByRole('button', { name: 'English' }))
  expect(screen.getByTestId('$inputs')).toHaveTextContent('Video')
  expect(screen.getByTestId('$outputs')).toHaveTextContent('Original subtitles')
  expect(screen.getByTestId('$outputs')).toHaveTextContent('Translated subtitles')
  expect(document.inputs[0].label).toBe('视频')
  expect(change).not.toHaveBeenCalled()
})

it('places clicked nodes using the current viewport and preserves the graph', async () => {
  const document = graph(), change = vi.fn(), selected = vi.fn()
  const add = createRef<((type: NodeTypeDefinition) => void) | null>()
  render(<LanguageProvider><WorkflowCanvas document={document} types={[type]} addNodeRef={add} onChange={change} onSelect={selected} onOpen={() => {}} fitOnLoad /></LanguageProvider>)
  expect(flow.fitView).toHaveBeenCalledWith({ padding: 0.12, minZoom: 0.75, maxZoom: 1 })
  act(() => add.current!(type))
  expect(flow.screenToFlowPosition).toHaveBeenCalledOnce()
  const next = change.mock.calls[0][0] as WorkflowDocument
  const added = next.nodes.at(-1)!
  expect(next.presentation.positions[added.id]).toEqual({ x: 1200, y: -300 })
  expect(next.nodes).toHaveLength(document.nodes.length + 1)
  expect(selected).toHaveBeenCalledWith(added.id)
  expect(document.nodes).toHaveLength(3)
})

it('shows a review action on every waiting node and read-only result actions elsewhere', async () => {
  const open = vi.fn(), steps: TaskStep[] = [{ id: 'a', label: 'A', status: 'awaiting_review', progress: 1, message: '正在提取原始音频' }, { id: 'b', label: 'B', status: 'awaiting_review', progress: 1 }, { id: 'c', label: 'C', status: 'completed', progress: 1 }]
  const { container } = render(<LanguageProvider><WorkflowCanvas document={graph()} types={[type]} steps={steps} readOnly onOpen={open} /></LanguageProvider>)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(document.querySelector('[aria-haspopup="menu"]')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '确认结果' })).toHaveLength(2)
  expect(screen.getAllByRole('button', { name: '查看结果' })).toHaveLength(1)
  expect(container.querySelectorAll('.workflow-node-review')).toHaveLength(2)
  expect(screen.queryByText('正在提取原始音频')).not.toBeInTheDocument()
  expect(screen.getAllByText('人工确认')).toHaveLength(2)
  expect(screen.queryByText('需确认结果')).not.toBeInTheDocument()
  await userEvent.setup().click(screen.getAllByRole('button', { name: '确认结果' })[1])
  expect(open).toHaveBeenCalledWith('b')
})

it('preserves a draft viewport and locks edit controls during submission', () => {
  const add = createRef<((type: NodeTypeDefinition) => void) | null>()
  render(<LanguageProvider><WorkflowCanvas document={graph()} types={[type]} addNodeRef={add} disabled fitOnLoad={false} onOpen={() => {}} /></LanguageProvider>)
  expect(flow.fitView).not.toHaveBeenCalled()
  expect(add.current).toBeNull()
  screen.getAllByRole('checkbox').forEach((input) => expect(input).toBeDisabled())
  screen.getAllByRole('button', { name: '完整设置' }).forEach((button) => expect(button).toBeDisabled())
})

it('positions boundary cards around the actual parallel layout without empty input cards', () => {
  const document = graph()
  document.presentation.positions = { a: { x: 0, y: -180 }, b: { x: 0, y: 440 }, c: { x: 330, y: 130 } }
  document.outputs = [{ id: 'result', label: '结果', kind: 'artifact', schemaId: 'file/v1', required: true, source: { nodeId: 'c', portId: 'file' } }]
  const { rerender } = render(<LanguageProvider><WorkflowCanvas document={document} types={[type]} onOpen={() => {}} /></LanguageProvider>)
  expect(screen.queryByTestId('$inputs')).not.toBeInTheDocument()
  expect(screen.getByTestId('$outputs')).toHaveAttribute('data-position', JSON.stringify({ x: 650, y: 130 }))
  expect(document.presentation.positions.$outputs).toBeUndefined()
  const withInputs = { ...document, inputs: [{ id: 'source', label: '素材', kind: 'artifact' as const, schemaId: 'file/v1', required: true, acceptedMimeTypes: [], maxBytes: 100 }] }
  rerender(<LanguageProvider><WorkflowCanvas document={withInputs} types={[type]} onOpen={() => {}} /></LanguageProvider>)
  expect(screen.getByTestId('$inputs')).toHaveAttribute('data-position', JSON.stringify({ x: -320, y: 130 }))
  rerender(<LanguageProvider><WorkflowCanvas document={{ ...withInputs, presentation: { ...document.presentation, positions: { ...document.presentation.positions, $outputs: { x: 700, y: 200 } } } }} types={[type]} onOpen={() => {}} /></LanguageProvider>)
  expect(screen.getByTestId('$outputs')).toHaveAttribute('data-position', JSON.stringify({ x: 700, y: 200 }))
})

it('opens unfinished nodes without promising results', async () => {
  const open = vi.fn(), steps: TaskStep[] = [{ id: 'a', label: 'A', status: 'pending', progress: 0 }, { id: 'b', label: 'B', status: 'running', progress: 0.2 }]
  render(<LanguageProvider><WorkflowCanvas document={graph()} types={[type]} steps={steps} readOnly onOpen={open} /></LanguageProvider>)
  expect(screen.queryByRole('button', { name: '查看结果' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: '查看节点' })).toHaveLength(3)
  await userEvent.setup().click(screen.getAllByRole('button', { name: '查看节点' })[0])
  expect(open).toHaveBeenCalledWith('a')
})

it('keeps the initial long graph readable at its start while manual fit can show all nodes', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  render(<LanguageProvider><WorkflowCanvas document={graph()} types={[type]} fitOnLoad onOpen={() => {}} /></LanguageProvider>)
  await waitFor(() => expect(flow.setViewport).toHaveBeenCalledWith({ x: 272, y: 30, zoom: 0.75 }))
  expect(flow.fitView).toHaveBeenCalledOnce()
  await userEvent.setup().click(screen.getByRole('button', { name: '适应画布' }))
  expect(flow.fitView).toHaveBeenLastCalledWith({ padding: 0.12, maxZoom: 1 })
})


it('uses typed numeric enums and model language options for canvas quick fields', async () => {
  const document = graph(); document.nodes = [document.nodes[0]]
  document.nodes[0].provider.model = 'small'
  document.nodes[0].config = { count: 1, language: 'zh' }
  const definition: NodeTypeDefinition = { ...type, provider: { ...type.provider, models: [{ id: 'small', languages: ['en'] }] }, configSchema: { properties: {
    count: { type: ['integer', 'null'], title: '次数', enum: [1, 2] },
    language: { type: 'string', title: '语言', 'x-optionsFrom': 'languages', 'x-options': [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }] },
  } }, ui: { quickFields: ['count', 'language'] } }
  const changed = vi.fn(), user = userEvent.setup()
  render(<LanguageProvider><WorkflowCanvas document={document} types={[definition]} onChange={changed} onOpen={() => {}} /></LanguageProvider>)
  await user.click(screen.getByLabelText('次数'))
  await user.click(screen.getByRole('menuitem', { name: '2' }))
  expect(changed.mock.calls.at(-1)![0].nodes[0].config.count).toBe(2)
  await user.click(screen.getByLabelText('语言'))
  expect(screen.getByRole('menuitem', { name: 'zh · 不可用' })).toBeDisabled()
  expect(screen.getByRole('menuitem', { name: 'English' })).toBeInTheDocument()
})


it('keeps saved task labels and unique output ports when a node plugin is unavailable', () => {
  const document = graph()
  document.edges = [
    { id: 'ab', source: { nodeId: 'a', portId: 'translation' }, target: { nodeId: 'b', portId: 'text' } },
    { id: 'ac', source: { nodeId: 'a', portId: 'translation' }, target: { nodeId: 'c', portId: 'text' } },
  ]
  const steps: TaskStep[] = [
    { id: 'a', label: { default: 'Translate', translations: { zh: '翻译' } }, status: 'completed', progress: 1, message: '正在翻译' },
    { id: 'b', label: '处理', status: 'waiting', progress: 0, message: '等待服务响应' },
  ]
  render(<LanguageProvider><WorkflowCanvas document={document} types={[]} steps={steps} readOnly onOpen={() => {}} /></LanguageProvider>)
  expect(screen.getByText('翻译')).toBeInTheDocument()
  expect(screen.getAllByText('缺少节点插件')).toHaveLength(3)
  expect(screen.getAllByText('translation')).toHaveLength(1)
  expect(screen.queryByText('正在翻译')).not.toBeInTheDocument()
  expect(screen.getByText('等待服务响应')).toBeInTheDocument()
})
