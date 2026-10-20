import { useMemo, useState } from 'react'
import { Background, Controls, Handle, Position, ReactFlow, type Connection, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import { ExternalLink, FileInput, FileOutput, Workflow, X } from 'lucide-react'
import { text, type GraphNode, type NodeTypeDefinition, type TaskStep, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { TaskState } from './task-status'
import { fieldType } from './schema-form'
import { canConnect, connect, INPUTS_ID, nodeDefinition, OUTPUTS_ID, removeNodes } from './workflow-utils'
import '@xyflow/react/dist/style.css'
import './workflow.css'

type CardData = {
  label: string; node?: GraphNode; definition?: NodeTypeDefinition; status?: TaskStep
  inputs: { id: string; label: string; required: boolean; connected: boolean }[]
  outputs: { id: string; label: string }[]
  readOnly: boolean; missing: boolean; virtual?: 'input' | 'output'
  change?(node: GraphNode): void; open?(): void
}
type FlowNode = Node<CardData, 'workflow'>

function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const tx = useText(), { language } = useI18n()
  const node = data.node
  return <div className={cn('workflow-node', selected && 'workflow-node-selected', data.status?.status === 'awaiting_review' && 'workflow-node-review', data.missing && 'workflow-node-missing')}>
    <div className="workflow-node-drag flex items-center gap-2 border-b border-border px-4 py-3">
      {data.virtual === 'input' ? <FileInput className="size-4 text-brand-blue" /> : data.virtual === 'output' ? <FileOutput className="size-4 text-brand-blue" /> : <Workflow className="size-4 text-brand-pink" />}
      <strong className="min-w-0 flex-1 truncate text-sm">{data.label}</strong>
      {data.status && <TaskState status={data.status.status} />}
    </div>
    {data.missing && <p className="px-4 pt-3 text-xs text-status-danger-fg">{tx('Missing node plugin', '缺少节点插件', 'ノードプラグインがありません')}</p>}
    <div className="grid grid-cols-2 gap-x-3 py-3 text-[11px]">
      <div className="space-y-2">{data.inputs.map((port) => <div className="relative min-h-5 pr-1 pl-4" key={port.id}>
        <Handle type="target" position={Position.Left} id={port.id} isConnectable={!data.readOnly} aria-label={`${data.label} ${port.label}`} />
        <span className={cn(port.required && !port.connected && !data.readOnly && 'text-status-warning-fg')}>{port.label}{port.required ? ' *' : ''}</span>
      </div>)}</div>
      <div className="space-y-2">{data.outputs.map((port) => <div className="relative min-h-5 pr-4 pl-1 text-right" key={port.id}>
        <span>{port.label}</span><Handle type="source" position={Position.Right} id={port.id} isConnectable={!data.readOnly} aria-label={`${data.label} ${port.label}`} />
      </div>)}</div>
    </div>
    {node && <>
      {!!data.definition?.ui?.quickFields?.length && <div className="nodrag nowheel space-y-2 border-t border-border px-4 py-3">
        {data.definition.ui.quickFields.slice(0, 3).map((key) => {
          const schema = data.definition?.configSchema.properties?.[key]
          if (!schema || !['string', 'number', 'integer', 'boolean'].includes(fieldType(schema) ?? '')) return null
          return <label className="flex items-center justify-between gap-2 text-xs" key={key}><span className="truncate">{text(schema['x-title'] ?? schema.title, language) || key}</span>
            {schema.type === 'boolean' ? <input type="checkbox" disabled={data.readOnly} checked={Boolean(node.config[key])} onChange={(event) => data.change?.({ ...node, config: { ...node.config, [key]: event.target.checked } })} /> : schema.enum ? <select aria-label={text(schema['x-title'] ?? schema.title, language) || key} disabled={data.readOnly} className="w-28 rounded-md border border-input bg-input-bg px-1 py-1" value={String(node.config[key] ?? '')} onChange={(event) => data.change?.({ ...node, config: { ...node.config, [key]: event.target.value } })}><option value="">—</option>{schema.enum.map((value) => <option key={String(value)} value={String(value)}>{String(value)}</option>)}</select> : <input aria-label={text(schema['x-title'] ?? schema.title, language) || key} disabled={data.readOnly} type={schema.type === 'string' ? 'text' : 'number'} className="w-28 rounded-md border border-input bg-input-bg px-2 py-1" value={String(node.config[key] ?? '')} onChange={(event) => data.change?.({ ...node, config: { ...node.config, [key]: schema.type === 'string' ? event.target.value : Number(event.target.value) } })} />}
          </label>
        })}
      </div>}
      <div className="nodrag flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs">
        <label className="flex items-center gap-2"><input type="checkbox" className="accent-primary" disabled={data.readOnly} checked={node.autoContinue} onChange={(event) => data.change?.({ ...node, autoContinue: event.target.checked })} />{tx('Auto continue', '自动下一步', '自動で次へ')}</label>
        <button type="button" className="flex items-center gap-1 rounded px-1 py-1 text-link hover:bg-accent" onClick={data.open}>{tx('Open', '打开节点', '開く')}<ExternalLink className="size-3" /></button>
      </div>
    </>}
    {data.status?.message && <p className="truncate px-4 pb-3 text-xs text-muted-foreground">{data.status.message}</p>}
    {data.status?.error && <p className="px-4 pb-3 text-xs text-status-danger-fg">{data.status.error.message}</p>}
    {data.status?.status === 'running' && data.status.progress != null && <progress className="block h-1 w-full accent-primary" value={data.status.progress} max={1} aria-label={data.label} />}
  </div>
}
const nodeTypes = { workflow: NodeCard }

export function WorkflowCanvas({ document, types, readOnly = false, steps = [], selected, onSelect, onChange, onCheckpoint, onOpen }: {
  document: WorkflowDocument; types: NodeTypeDefinition[]; readOnly?: boolean; steps?: TaskStep[]
  selected?: string; onSelect?(id?: string): void; onChange?(document: WorkflowDocument, checkpoint?: boolean): void; onCheckpoint?(): void; onOpen(id: string): void
}) {
  const tx = useText(), { language } = useI18n()
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode> | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string>()
  const [viewPositions, setViewPositions] = useState<Record<string, { x: number; y: number }>>({})
  // Controlled nodes must retain React Flow's measurements. Rebuilding their
  // data after an edit without these values resets visibility and port bounds.
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({})
  const nodes: FlowNode[] = useMemo(() => {
    const execution = document.nodes.map((node, index) => {
      const definition = nodeDefinition(node, types)
      return {
        id: node.id, type: 'workflow' as const, dragHandle: '.workflow-node-drag', selected: node.id === selected,
        position: viewPositions[node.id] ?? document.presentation.positions[node.id] ?? { x: (index + 1) * 320, y: 60 },
        data: {
          label: node.label || text(definition?.label, language) || node.type, node, definition,
          status: steps.find((step) => step.id === node.id), readOnly, missing: !definition,
          inputs: definition?.inputs.map((port) => ({ id: port.id, label: text(port.label, language), required: port.required, connected: document.edges.some((edge) => edge.target.nodeId === node.id && edge.target.portId === port.id) })) ?? document.edges.filter((edge) => edge.target.nodeId === node.id).map((edge) => ({ id: edge.target.portId, label: edge.target.portId, required: false, connected: true })),
          outputs: definition?.outputs.map((port) => ({ id: port.name, label: text(port.label, language) || port.name })) ?? document.edges.filter((edge) => edge.source.nodeId === node.id).map((edge) => ({ id: edge.source.portId, label: edge.source.portId })),
          change: (next: GraphNode) => onChange?.({ ...document, nodes: document.nodes.map((item) => item.id === next.id ? next : item) }),
          open: () => onOpen(node.id),
        },
      }
    })
    const virtual: FlowNode[] = [
      { id: INPUTS_ID, type: 'workflow', dragHandle: '.workflow-node-drag', position: viewPositions[INPUTS_ID] ?? document.presentation.positions[INPUTS_ID] ?? { x: 0, y: 60 }, data: { label: tx('Inputs', '输入', '入力'), inputs: [], outputs: document.inputs.map((input) => ({ id: input.id, label: input.label })), readOnly, missing: false, virtual: 'input' } },
      { id: OUTPUTS_ID, type: 'workflow', dragHandle: '.workflow-node-drag', position: viewPositions[OUTPUTS_ID] ?? document.presentation.positions[OUTPUTS_ID] ?? { x: (document.nodes.length + 1) * 320, y: 60 }, data: { label: tx('Outputs', '输出', '出力'), outputs: [], inputs: document.outputs.map((output) => ({ id: output.id, label: output.label, required: output.required, connected: true })), readOnly, missing: false, virtual: 'output' } },
    ]
    return [...virtual, ...execution].map((node) => ({ ...node, measured: measurements[node.id] }))
  }, [document, types, language, readOnly, steps, selected, viewPositions, measurements, onChange, onOpen, tx])
  const edges = [
    ...document.edges.map((edge) => ({ id: edge.id, source: edge.source.nodeId, sourceHandle: edge.source.portId, target: edge.target.nodeId, targetHandle: edge.target.portId, selected: selectedEdge === edge.id })),
    ...document.outputs.map((port) => ({ id: `output:${port.id}`, source: port.source.nodeId, sourceHandle: port.source.portId, target: OUTPUTS_ID, targetHandle: port.id, selected: selectedEdge === `output:${port.id}` })),
  ]
  function valid(connection: Connection | { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
    return !readOnly && !!connection.sourceHandle && !!connection.targetHandle && canConnect(document, types, { nodeId: connection.source, portId: connection.sourceHandle }, { nodeId: connection.target, portId: connection.targetHandle })
  }
  return <div className="workflow-canvas relative h-full min-h-80" onDrop={(event) => {
    event.preventDefault()
    if (readOnly || !flow) return
    const typeId = event.dataTransfer.getData('application/youdub-node')
    const definition = types.find((type) => `${type.providerId}:${type.type}` === typeId)
    if (!definition) return
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const node = createNode(definition)
    onChange?.({ ...document, nodes: [...document.nodes, node], presentation: { ...document.presentation, positions: { ...document.presentation.positions, [node.id]: position } } })
    onSelect?.(node.id)
  }} onDragOver={(event) => { if (!readOnly) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}>
    <ReactFlow<FlowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlow} fitView={readOnly} minZoom={0.15} maxZoom={2} defaultViewport={document.presentation.viewport} onlyRenderVisibleElements={false}
      nodesConnectable={!readOnly} edgesReconnectable={false} deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']} panOnScroll panOnDrag zoomOnDoubleClick={false}
      onNodeClick={(_, node) => { onSelect?.(node.id); setSelectedEdge(undefined) }} onPaneClick={() => { onSelect?.(); setSelectedEdge(undefined) }} onNodeDoubleClick={(_, node) => { if (!node.id.startsWith('$')) onOpen(node.id) }}
      onEdgeClick={(_, edge) => { setSelectedEdge(edge.id); onSelect?.() }} isValidConnection={valid}
      onConnect={(connection) => { if (valid(connection)) onChange?.(connect(document, { nodeId: connection.source, portId: connection.sourceHandle! }, { nodeId: connection.target, portId: connection.targetHandle! })) }}
      onNodeDragStart={() => { if (!readOnly) onCheckpoint?.() }}
      onNodesChange={(changes) => {
        const dimensions = changes.flatMap((change) => change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : [])
        if (dimensions.length) setMeasurements((current) => ({ ...current, ...Object.fromEntries(dimensions) }))
        const positions = changes.flatMap((change) => change.type === 'position' && change.position ? [[change.id, change.position] as const] : [])
        if (positions.length) {
          if (readOnly) setViewPositions((current) => ({ ...current, ...Object.fromEntries(positions) }))
          else onChange?.({ ...document, presentation: { ...document.presentation, positions: { ...document.presentation.positions, ...Object.fromEntries(positions) } } }, false)
        }
        const removed = changes.flatMap((change) => change.type === 'remove' && !change.id.startsWith('$') ? [change.id] : [])
        if (removed.length && !readOnly) onChange?.(removeNodes(document, removed))
      }}
      onEdgesDelete={(removed) => { if (!readOnly) onChange?.({ ...document, edges: document.edges.filter((edge) => !removed.some((item) => item.id === edge.id)), outputs: document.outputs.filter((port) => !removed.some((item) => item.id === `output:${port.id}`)) }) }}
      onMoveEnd={(_, viewport) => { if (!readOnly && flow) onChange?.({ ...document, presentation: { ...document.presentation, viewport } }, false) }}
      onKeyDown={(event) => { const target = event.target as HTMLElement; const id = target.closest('.react-flow__node')?.getAttribute('data-id'); if (event.key === 'Enter' && id && !id.startsWith('$') && !target.closest('input,button,textarea,select')) onOpen(id) }}
      ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': tx('Zoom in', '放大', '拡大'), 'controls.zoomOut.ariaLabel': tx('Zoom out', '缩小', '縮小'), 'controls.fitView.ariaLabel': tx('Fit view', '适应画布', '全体を表示') }}>
      <Background gap={24} size={1} /><Controls showInteractive={false} />
    </ReactFlow>
    {selectedEdge && !readOnly && <div className="absolute top-3 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 shadow-card"><span className="truncate text-xs">{edges.find((edge) => edge.id === selectedEdge)?.sourceHandle} → {edges.find((edge) => edge.id === selectedEdge)?.targetHandle}</span><button type="button" aria-label={tx('Delete connection', '删除连线', '接続を削除')} onClick={() => { onChange?.({ ...document, edges: document.edges.filter((edge) => edge.id !== selectedEdge), outputs: document.outputs.filter((port) => `output:${port.id}` !== selectedEdge) }); setSelectedEdge(undefined) }}><X className="size-4" /></button></div>}
  </div>
}
export function createNode(definition: NodeTypeDefinition): GraphNode {
  const model = definition.provider.models?.[0]
  return { id: crypto.randomUUID(), type: definition.type, typeVersion: definition.version, provider: { id: definition.providerId, ...(model ? { model: typeof model === 'string' ? model : model.id, device: typeof model === 'string' ? 'cpu' : model.devices?.[0] ?? 'cpu' } : {}) }, config: structuredClone(definition.defaults), autoContinue: true }
}
