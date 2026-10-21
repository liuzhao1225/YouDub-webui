import { Input } from '@/components/ui/input'
import { NativeSelect, Choice } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Background, Controls, Handle, Position, ReactFlow, type Connection, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import { ExternalLink, FileInput, FileOutput, Workflow, X } from 'lucide-react'
import { text, type GraphNode, type NodeTypeDefinition, type TaskStep, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { TaskState } from './task-status'
import { fieldOptions, fieldType, fieldValue, nodeModel } from '@/runtime/schema-fields'
import { canConnect, connect, INPUTS_ID, nodeDefinition, OUTPUTS_ID, removeNodes } from './workflow-utils'
import '@xyflow/react/dist/style.css'
import './workflow.css'

type CardData = {
  label: string; node?: GraphNode; definition?: NodeTypeDefinition; status?: TaskStep
  inputs: { id: string; label: string; required: boolean; connected: boolean }[]
  outputs: { id: string; label: string }[]
  readOnly: boolean; disabled: boolean; missing: boolean; virtual?: 'input' | 'output'
  change?(node: GraphNode): void; open?(): void
}
type FlowNode = Node<CardData, 'workflow'>
const NODE_COLUMN_SPACING = 320

function NodeCard({ data, selected }: NodeProps<FlowNode>) {
  const tx = useText(), { language } = useI18n()
  const node = data.node
  return <div className={cn('workflow-node', selected && 'workflow-node-selected', data.status?.status === 'awaiting_review' && 'workflow-node-review', data.missing && 'workflow-node-missing')}>
    <div className="workflow-node-drag flex items-center gap-2 border-b border-border px-4 py-3">
      {data.virtual === 'input' ? <FileInput className="size-4 text-brand-blue" /> : data.virtual === 'output' ? <FileOutput className="size-4 text-brand-blue" /> : <Workflow className="size-4 text-brand-pink" />}
      <strong className="min-w-0 flex-1 truncate text-sm">{data.label}</strong>
      {data.status && <TaskState status={data.status.status} />}
    </div>
    {data.missing && <p className="px-4 pt-3 text-xs text-status-danger-fg">{tx("workflow.canvas.missing.node.plugin")}</p>}
    <div className="grid grid-cols-2 gap-x-3 py-3 text-[11px]">
      <div className="space-y-2">{data.inputs.map((port) => <div className="relative min-h-5 pr-1 pl-4" key={port.id}>
        <Handle type="target" position={Position.Left} id={port.id} isConnectable={!data.readOnly && !data.disabled} aria-label={`${data.label} ${port.label}`} />
        <span className={cn(port.required && !port.connected && !data.readOnly && 'text-status-warning-fg')}>{port.label}{port.required ? ' *' : ''}</span>
      </div>)}</div>
      <div className="space-y-2">{data.outputs.map((port) => <div className="relative min-h-5 pr-4 pl-1 text-right" key={port.id}>
        <span>{port.label}</span><Handle type="source" position={Position.Right} id={port.id} isConnectable={!data.readOnly && !data.disabled} aria-label={`${data.label} ${port.label}`} />
      </div>)}</div>
    </div>
    {node && <>
      {!!data.definition?.ui?.quickFields?.length && <div className="nodrag nowheel space-y-2 border-t border-border px-4 py-3">
        {data.definition.ui.quickFields.slice(0, 3).map((key) => {
          const schema = data.definition?.configSchema.properties?.[key]
          if (!schema || !['string', 'number', 'integer', 'boolean'].includes(fieldType(schema) ?? '')) return null
          const type = fieldType(schema), { options, constrained } = fieldOptions(schema, nodeModel(node, data.definition))
          const value = node.config[key]
          if (constrained && value !== undefined && !options.some(option => option.value === value)) options.unshift({ value, label: `${String(value)} · ${tx("workflow.canvas.unavailable")}`, disabled: true })
          return <div className="flex items-center justify-between gap-2 text-xs" key={key}><span className="truncate">{text(schema['x-title'] ?? schema.title, language) || key}</span>
            {data.readOnly ? <span className="max-w-28 truncate text-muted-foreground" title={String(node.config[key] ?? '')}>{type === 'boolean' ? node.config[key] ? tx("workflow.canvas.on") : tx("workflow.canvas.off") : String(node.config[key] ?? '—')}</span> : type === 'boolean' && !constrained ? <Choice className="[&_span]:sr-only" aria-label={text(schema['x-title'] ?? schema.title, language) || key} disabled={data.disabled} checked={Boolean(node.config[key])} onChange={(event) => data.change?.({ ...node, config: { ...node.config, [key]: event.target.checked } })} /> : constrained ? <NativeSelect aria-label={text(schema['x-title'] ?? schema.title, language) || key} disabled={data.disabled} className="h-7 w-28 rounded-md border border-input bg-input-bg px-1 py-1 text-xs" value={String(node.config[key] ?? '')} onChange={(event) => data.change?.({ ...node, config: { ...node.config, [key]: options.find(option => String(option.value) === event.target.value)?.value } })}><option value="">—</option>{options.map(option => <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>{text(option.label, language)}</option>)}</NativeSelect> : <Input aria-label={text(schema['x-title'] ?? schema.title, language) || key} disabled={data.disabled} type={type === 'string' ? 'text' : 'number'} className="h-7 w-28 rounded-md border border-input bg-input-bg px-2 py-1 text-xs" value={String(node.config[key] ?? '')} onChange={(event) => data.change?.({ ...node, config: { ...node.config, [key]: fieldValue(schema, event.target.value) } })} />}
          </div>
        })}
      </div>}
      <div className="nodrag flex items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs">
        {data.readOnly ? <span className="text-muted-foreground">{node.autoContinue ? tx("workflow.canvas.auto.continue") : tx("workflow.canvas.manual.review")}</span> : <Choice className="flex items-center gap-2" label={tx("workflow.canvas.auto.continue")} disabled={data.disabled} checked={node.autoContinue} onChange={(event) => data.change?.({ ...node, autoContinue: event.target.checked })} />}
        <Button variant="ghost" type="button" disabled={data.disabled} className={cn('flex h-auto items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-50', data.status?.status === 'awaiting_review' ? 'bg-primary text-primary-foreground' : 'text-link hover:bg-accent')} onClick={data.open}>{data.readOnly ? data.status?.status === 'awaiting_review' ? tx("workflow.canvas.review.result") : data.status?.status === 'completed' ? tx("workflow.canvas.view.results") : tx("workflow.canvas.view.node") : tx("workflow.canvas.full.settings")}<ExternalLink className="size-3" /></Button>
      </div>
    </>}
    {data.status?.message && <p className="truncate px-4 pb-3 text-xs text-muted-foreground">{data.status.message}</p>}
    {data.status?.error && <p className="px-4 pb-3 text-xs text-status-danger-fg">{data.status.error.message}</p>}
    {data.status?.status === 'running' && data.status.progress != null && <progress className="block h-1 w-full accent-primary" value={data.status.progress} max={1} aria-label={data.label} />}
  </div>
}
const nodeTypes = { workflow: NodeCard }

export function WorkflowCanvas({ document, types, readOnly = false, disabled = false, fitOnLoad = false, steps = [], selected, addNodeRef, onReady, onSelect, onChange, onCheckpoint, onOpen }: {
  document: WorkflowDocument; types: NodeTypeDefinition[]; readOnly?: boolean; steps?: TaskStep[]
  disabled?: boolean; fitOnLoad?: boolean; addNodeRef?: RefObject<((type: NodeTypeDefinition) => void) | null>; onReady?(): void
  selected?: string; onSelect?(id?: string): void; onChange?(document: WorkflowDocument, checkpoint?: boolean): void; onCheckpoint?(): void; onOpen(id: string): void
}) {
  const tx = useText(), { language } = useI18n()
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode> | null>(null)
  const container = useRef<HTMLDivElement>(null)
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
        position: viewPositions[node.id] ?? document.presentation.positions[node.id] ?? { x: (index + 1) * NODE_COLUMN_SPACING, y: 60 },
        data: {
          label: node.label || text(definition?.label, language) || node.type, node, definition,
          status: steps.find((step) => step.id === node.id), readOnly, disabled, missing: !definition,
          inputs: definition?.inputs.map((port) => ({ id: port.id, label: text(port.label, language), required: port.required, connected: document.edges.some((edge) => edge.target.nodeId === node.id && edge.target.portId === port.id) })) ?? document.edges.filter((edge) => edge.target.nodeId === node.id).map((edge) => ({ id: edge.target.portId, label: edge.target.portId, required: false, connected: true })),
          outputs: definition?.outputs.map((port) => ({ id: port.name, label: text(port.label, language) || port.name })) ?? document.edges.filter((edge) => edge.source.nodeId === node.id).map((edge) => ({ id: edge.source.portId, label: edge.source.portId })),
          change: (next: GraphNode) => onChange?.({ ...document, nodes: document.nodes.map((item) => item.id === next.id ? next : item) }),
          open: () => onOpen(node.id),
        },
      }
    })
    const xs = execution.map((node) => node.position.x), ys = execution.map((node) => node.position.y)
    const centerY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 60
    // Boundary cards follow the actual layout, including graphs with parallel branches.
    const inputPosition = { x: xs.length ? Math.min(...xs) - NODE_COLUMN_SPACING : 0, y: centerY }
    const outputPosition = { x: xs.length ? Math.max(...xs) + NODE_COLUMN_SPACING : NODE_COLUMN_SPACING, y: centerY }
    const virtual: FlowNode[] = []
    if (document.inputs.length) virtual.push({ id: INPUTS_ID, type: 'workflow', dragHandle: '.workflow-node-drag', position: viewPositions[INPUTS_ID] ?? document.presentation.positions[INPUTS_ID] ?? inputPosition, data: { label: tx("workflow.canvas.inputs"), inputs: [], outputs: document.inputs.map((input) => ({ id: input.id, label: input.label })), readOnly, disabled, missing: false, virtual: 'input' } })
    if (document.outputs.length) virtual.push({ id: OUTPUTS_ID, type: 'workflow', dragHandle: '.workflow-node-drag', position: viewPositions[OUTPUTS_ID] ?? document.presentation.positions[OUTPUTS_ID] ?? outputPosition, data: { label: tx("workflow.canvas.outputs"), outputs: [], inputs: document.outputs.map((output) => ({ id: output.id, label: output.label, required: output.required, connected: true })), readOnly, disabled, missing: false, virtual: 'output' } })
    return [...virtual, ...execution].map((node) => ({ ...node, measured: measurements[node.id] }))
  }, [document, types, language, readOnly, disabled, steps, selected, viewPositions, measurements, onChange, onOpen, tx])
  useEffect(() => {
    if (!addNodeRef) return
    addNodeRef.current = !flow || readOnly || disabled ? null : (definition) => {
      const bounds = container.current!.getBoundingClientRect()
      const center = flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 })
      const size = nodes.find((node) => node.measured)?.measured
      const node = createNode(definition)
      const position = { x: center.x - (size?.width ?? 0) / 2, y: center.y - (size?.height ?? 0) / 2 }
      onChange?.({ ...document, nodes: [...document.nodes, node], presentation: { ...document.presentation, positions: { ...document.presentation.positions, [node.id]: position } } })
      onSelect?.(node.id)
    }
    return () => { addNodeRef.current = null }
  }, [addNodeRef, flow, readOnly, disabled, document, nodes, onChange, onSelect])
  const edges = [
    ...document.edges.map((edge) => ({ id: edge.id, source: edge.source.nodeId, sourceHandle: edge.source.portId, target: edge.target.nodeId, targetHandle: edge.target.portId, selected: selectedEdge === edge.id })),
    ...document.outputs.map((port) => ({ id: `output:${port.id}`, source: port.source.nodeId, sourceHandle: port.source.portId, target: OUTPUTS_ID, targetHandle: port.id, selected: selectedEdge === `output:${port.id}` })),
  ]
  function valid(connection: Connection | { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) {
    return !readOnly && !disabled && !!connection.sourceHandle && !!connection.targetHandle && canConnect(document, types, { nodeId: connection.source, portId: connection.sourceHandle }, { nodeId: connection.target, portId: connection.targetHandle })
  }
  return <div ref={container} className="workflow-canvas relative h-full min-h-80" onDrop={(event) => {
    event.preventDefault()
    if (readOnly || disabled || !flow) return
    const typeId = event.dataTransfer.getData('application/youdub-node')
    const definition = types.find((type) => `${type.providerId}:${type.type}` === typeId)
    if (!definition) return
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const node = createNode(definition)
    onChange?.({ ...document, nodes: [...document.nodes, node], presentation: { ...document.presentation, positions: { ...document.presentation.positions, [node.id]: position } } })
    onSelect?.(node.id)
  }} onDragOver={(event) => { if (!readOnly && !disabled) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}>
    <ReactFlow<FlowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={async (instance) => {
      setFlow(instance); onReady?.()
      if (!readOnly && !fitOnLoad) return
      await instance.fitView({ padding: 0.12, minZoom: 0.75, maxZoom: 1 })
      const width = container.current?.clientWidth
      if (!width) return
      const bounds = instance.getNodesBounds(nodes), viewport = instance.getViewport(), padding = width * 0.12
      if (bounds.width * viewport.zoom > width - 2 * padding) await instance.setViewport({ ...viewport, x: padding - bounds.x * viewport.zoom })
    }} minZoom={0.15} maxZoom={2} defaultViewport={document.presentation.viewport} onlyRenderVisibleElements={false}
      nodesDraggable={!disabled} nodesConnectable={!readOnly && !disabled} edgesReconnectable={false} deleteKeyCode={readOnly || disabled ? null : ['Backspace', 'Delete']} panOnScroll panOnDrag zoomOnDoubleClick={false}
      onNodeClick={(_, node) => { onSelect?.(node.id); setSelectedEdge(undefined) }} onPaneClick={() => { onSelect?.(); setSelectedEdge(undefined) }} onNodeDoubleClick={(_, node) => { if (!node.id.startsWith('$')) onOpen(node.id) }}
      onEdgeClick={(_, edge) => { setSelectedEdge(edge.id); onSelect?.() }} isValidConnection={valid}
      onConnect={(connection) => { if (valid(connection)) onChange?.(connect(document, { nodeId: connection.source, portId: connection.sourceHandle! }, { nodeId: connection.target, portId: connection.targetHandle! })) }}
      onNodeDragStart={() => { if (!readOnly && !disabled) onCheckpoint?.() }}
      onNodesChange={(changes) => {
        const dimensions = changes.flatMap((change) => change.type === 'dimensions' && change.dimensions ? [[change.id, change.dimensions] as const] : [])
        if (dimensions.length) setMeasurements((current) => ({ ...current, ...Object.fromEntries(dimensions) }))
        const positions = changes.flatMap((change) => change.type === 'position' && change.position ? [[change.id, change.position] as const] : [])
        if (positions.length) {
          if (readOnly) setViewPositions((current) => ({ ...current, ...Object.fromEntries(positions) }))
          else if (!disabled) onChange?.({ ...document, presentation: { ...document.presentation, positions: { ...document.presentation.positions, ...Object.fromEntries(positions) } } }, false)
        }
        const removed = changes.flatMap((change) => change.type === 'remove' && !change.id.startsWith('$') ? [change.id] : [])
        if (removed.length && !readOnly && !disabled) onChange?.(removeNodes(document, removed))
      }}
      onEdgesDelete={(removed) => { if (!readOnly && !disabled) onChange?.({ ...document, edges: document.edges.filter((edge) => !removed.some((item) => item.id === edge.id)), outputs: document.outputs.filter((port) => !removed.some((item) => item.id === `output:${port.id}`)) }) }}
      onMoveEnd={(_, viewport) => { if (!readOnly && !disabled) onChange?.({ ...document, presentation: { ...document.presentation, viewport } }, false) }}
      onKeyDown={(event) => { const target = event.target as HTMLElement; const id = target.closest('.react-flow__node')?.getAttribute('data-id'); if (event.key === 'Enter' && id && !id.startsWith('$') && !target.closest('input,button,textarea,select')) onOpen(id) }}
      ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': tx("workflow.canvas.zoom.in"), 'controls.zoomOut.ariaLabel': tx("workflow.canvas.zoom.out"), 'controls.fitView.ariaLabel': tx("workflow.canvas.fit.view") }}>
      <Background gap={24} size={1} /><Controls showInteractive={false} fitViewOptions={{ padding: 0.12, maxZoom: 1 }} />
    </ReactFlow>
    {selectedEdge && !readOnly && !disabled && <div className="absolute top-3 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card px-4 py-2 shadow-card"><span className="truncate text-xs">{edges.find((edge) => edge.id === selectedEdge)?.sourceHandle} → {edges.find((edge) => edge.id === selectedEdge)?.targetHandle}</span><Button variant="ghost" size="icon-xs" type="button" aria-label={tx("workflow.canvas.delete.connection")} onClick={() => { onChange?.({ ...document, edges: document.edges.filter((edge) => edge.id !== selectedEdge), outputs: document.outputs.filter((port) => `output:${port.id}` !== selectedEdge) }); setSelectedEdge(undefined) }}><X className="size-4" /></Button></div>}
  </div>
}
export function createNode(definition: NodeTypeDefinition): GraphNode {
  const model = definition.provider.models?.find(item => typeof item === 'string' || item.available !== false)
  return { id: crypto.randomUUID(), type: definition.type, typeVersion: definition.version, provider: { id: definition.providerId, ...(model ? { model: typeof model === 'string' ? model : model.id, device: typeof model === 'string' ? 'cpu' : model.devices?.[0] ?? 'cpu' } : {}) }, config: structuredClone(definition.defaults), autoContinue: true }
}
