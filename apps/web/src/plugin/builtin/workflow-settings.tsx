import { NativeSelect, Choice } from '@/components/ui/native-select'
import type { Bindings } from '../sdk'
import { Component, type ReactNode } from 'react'
import { Copy, ExternalLink, Plus, Trash2, X } from '@/lib/icons'
import { Link, text, type GraphNode, type NodeEditorProps, type NodeTypeDefinition, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { nodeModel } from '@/runtime/schema-fields'
import { ConfigEditor } from './schema-form'
import { canConnect, connect, endpointKey, INPUTS_ID, nodeDefinition, sources, workflowPortLabel } from './workflow-utils'

export class NodePluginBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { error: string; generic: boolean }> {
  state = { error: '', generic: false }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() {
    if (this.state.generic) return this.props.fallback
    if (this.state.error) return <div className="space-y-3"><InlineAlert>{this.state.error}</InlineAlert><FallbackButton onClick={() => this.setState({ generic: true })} /></div>
    return this.props.children
  }
}
function FallbackButton({ onClick }: { onClick(): void }) {
  const tx = useText()
  return <Button variant="outline" onClick={onClick}>{tx("workflow.settings.open.read.only.view")}</Button>
}
export function SynthesizeNodeEditor({ node, definition, readOnly, onChange, useSlot }: NodeEditorProps & Bindings<'useSlot'>) {
  const tx = useText(), { language } = useI18n()
  const model = definition.provider.models?.find((model) => typeof model !== 'string' && model.id === node.provider.model)
  const modes = model && typeof model !== 'string' ? model.voice_modes ?? [] : []
  const voices = model && typeof model !== 'string' ? (model.voices ?? []).filter((voice) => !voice.languages || voice.languages.includes(String(node.config.targetLanguage))) : []
  const voice = node.config.voice as { mode?: string; id?: string } | undefined
  const properties = Object.fromEntries(Object.entries(definition.configSchema.properties ?? {}).filter(([name]) => name !== 'voice'))
  return <div className="space-y-4">
    <ConfigEditor model={nodeModel(node, definition)} useSlot={useSlot} ownerId="youdub.synthesize.options" value={node.config} schema={{ ...definition.configSchema, properties, required: definition.configSchema.required?.filter((name) => name !== 'voice') }} diagnostics={[]} readOnly={readOnly} onChange={(config) => onChange({ ...node, config })} />
    <label className="grid gap-2 text-sm">{tx("workflow.settings.voice.mode")}<NativeSelect className="min-w-0" disabled={readOnly || !modes.length} value={voice?.mode ?? ''} onChange={(event) => onChange({ ...node, config: { ...node.config, voice: { mode: event.target.value } } })}>
      {!modes.includes(voice?.mode ?? '') && <option value={voice?.mode ?? ''}>{voice?.mode === 'source_clone' ? tx("workflow.settings.source.voice.clone") : tx("workflow.settings.choose.a.model.first")}</option>}
      {modes.map((mode) => <option key={mode} value={mode}>{mode === 'source_clone' ? tx("workflow.settings.source.voice.clone") : mode === 'preset' ? tx("workflow.settings.preset.voice") : mode}</option>)}
    </NativeSelect></label>
    {voice?.mode === 'preset' && <label className="grid gap-2 text-sm">{tx("workflow.settings.voice")}<NativeSelect disabled={readOnly} className="min-w-0" value={voice.id ?? ''} onChange={(event) => onChange({ ...node, config: { ...node.config, voice: { mode: 'preset', id: event.target.value } } })}><option value="">{tx("workflow.settings.choose.voice")}</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{text(voice.label, language) || voice.id}</option>)}</NativeSelect></label>}
  </div>
}
export function NodeSettings({ document, node, types, onChange, onClose, onOpen, onDelete, readOnly = false, useSlot }: {
  document: WorkflowDocument; node: GraphNode; types: NodeTypeDefinition[]; onChange(document: WorkflowDocument): void; onClose?(): void; onOpen?(): void; onDelete?(): void; readOnly?: boolean
} & Bindings<'useSlot'>) {
  const tx = useText(), { language } = useI18n()
  const definition = nodeDefinition(node, types)
  const editors = useSlot('workflow.node.editors')
  const Custom = editors.find((entry) => entry.id === definition?.ui?.editorId)?.component
  const replace = (next: GraphNode) => onChange({ ...document, nodes: document.nodes.map((item) => item.id === node.id ? next : item) })
  const compatibleProviders = types.filter((type) => type.type === node.type && type.version === node.typeVersion && (!type.provider.legacy || type.providerId === node.provider.id))
  const models = definition?.provider.models ?? []
  const model = models.find((item) => (typeof item === 'string' ? item : item.id) === node.provider.model)
  const generic = <ConfigEditor model={nodeModel(node, definition)} useSlot={useSlot} ownerId={`node:${node.type}`} value={node.config} schema={definition?.configSchema ?? { type: 'object' }} readOnly={readOnly} diagnostics={[]} onChange={(config) => replace({ ...node, config })} />
  return <div className="space-y-4 p-4">
    <div className="flex items-center gap-2"><h2 className="min-w-0 flex-1 truncate font-semibold">{node.label || text(definition?.label, language) || node.type}</h2>{onClose && <Button disabled={readOnly} variant="ghost" size="icon-sm" aria-label={tx("workflow.settings.close.settings")} onClick={onClose}><X /></Button>}</div>
    {!definition && <InlineAlert>{tx("workflow.settings.the.required.node.plugin.or.version.is.unavailable")}</InlineAlert>}
    <label className="grid gap-2 text-sm">{tx("workflow.settings.name")}<Input disabled={readOnly} value={node.label ?? ''} placeholder={text(definition?.label, language) || node.type} onChange={(event) => replace({ ...node, label: event.target.value })} /></label>
    <label className="grid gap-2 text-sm">{tx("workflow.settings.provider")}<NativeSelect className="min-w-0" disabled={readOnly} value={node.provider.id} onChange={(event) => replace({ ...node, provider: { id: event.target.value } })}>{!compatibleProviders.length && <option>{node.provider.id}</option>}{compatibleProviders.map((type) => <option key={type.providerId} value={type.providerId}>{text(type.provider.label, language) || type.providerId}</option>)}</NativeSelect></label>
    {models.length > 0 && <label className="grid gap-2 text-sm">{tx("workflow.settings.model")}<NativeSelect className="min-w-0" disabled={readOnly} value={node.provider.model ?? ''} onChange={(event) => { const selected = models.find(item => typeof item !== 'string' && item.id === event.target.value); replace({ ...node, provider: { ...node.provider, model: event.target.value, ...(selected && typeof selected !== 'string' && selected.devices?.length === 1 ? { device: selected.devices[0] } : {}) } }) }}><option value="">{tx("workflow.settings.choose.model")}</option>{models.map((item) => <option key={typeof item === 'string' ? item : item.id} value={typeof item === 'string' ? item : item.id} disabled={typeof item !== 'string' && item.available === false}>{typeof item === 'string' ? item : `${item.name || item.id}${item.available === false ? tx("workflow.settings.unavailable") : ''}`}</option>)}</NativeSelect></label>}
    {model && typeof model !== 'string' && model.available === false && <InlineAlert>{model.unavailableReason}</InlineAlert>}
    {definition?.provider.capability === 'translation' && !models.length && <Link href="/settings/models" className="text-xs text-link">{tx("workflow.settings.add.model.provider")}</Link>}
    {model && typeof model !== 'string' && model.devices?.length && <label className="grid gap-2 text-sm">{tx("workflow.settings.device")}<NativeSelect disabled={readOnly}  value={node.provider.device ?? ''} onChange={(event) => replace({ ...node, provider: { ...node.provider, device: event.target.value } })}><option value="">—</option>{model.devices.map((device) => <option key={device}>{device}</option>)}</NativeSelect></label>}
    {definition && (Custom ? <NodePluginBoundary key={node.type} fallback={<pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(node.config, null, 2)}</pre>}><Custom node={node} definition={definition} diagnostics={[]} readOnly={readOnly} onChange={replace} /></NodePluginBoundary> : definition.ui?.editorId ? <InlineAlert>{tx("workflow.settings.node.editor.plugin.is.unavailable")} {definition.ui.editorId}</InlineAlert> : generic)}
    <Choice className="flex items-center gap-2 text-sm" label={tx("workflow.settings.auto.continue")} disabled={readOnly} checked={node.autoContinue} onChange={(event) => replace({ ...node, autoContinue: event.target.checked })} />
    {!node.autoContinue && <p className="text-xs text-muted-foreground">{tx("workflow.settings.pause.after.this.node.until.its.result.is.approved")}</p>}
    {!!definition?.inputs.length && <section className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">{tx("workflow.settings.input.sources")}</h3>
      {definition.inputs.map((input) => {
        const current = document.edges.find((edge) => edge.target.nodeId === node.id && edge.target.portId === input.id)
        const choices = sources(document, types, language).filter((source) => canConnect(document, types, source.source, { nodeId: node.id, portId: input.id }))
        return <label key={input.id} className="grid gap-1.5 text-xs">{text(input.label, language)}{input.required ? ' *' : ''}<NativeSelect disabled={readOnly} className="min-w-0" value={current ? endpointKey(current.source) : ''} onChange={(event) => {
          if (!event.target.value) onChange({ ...document, edges: document.edges.filter((edge) => edge !== current) })
          else { const [nodeId, portId] = JSON.parse(event.target.value) as [string, string]; onChange(connect(document, { nodeId, portId }, { nodeId: node.id, portId: input.id })) }
        }}><option value="">{tx("workflow.settings.not.connected")}</option>{choices.map((choice) => <option key={endpointKey(choice.source)} value={endpointKey(choice.source)}>{choice.label}</option>)}</NativeSelect></label>
      })}
    </section>}
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      {onOpen && <Button size="sm" variant="outline" disabled={readOnly} onClick={onOpen}><ExternalLink />{tx("workflow.settings.full.settings")}</Button>}
      {!readOnly && <><Button size="sm" variant="outline" onClick={() => { const id = crypto.randomUUID(); onChange({ ...document, nodes: [...document.nodes, { ...structuredClone(node), id }], presentation: { ...document.presentation, positions: { ...document.presentation.positions, [id]: { x: (document.presentation.positions[node.id]?.x ?? 0) + 40, y: (document.presentation.positions[node.id]?.y ?? 0) + 80 } } } }) }}><Copy />{tx("workflow.settings.duplicate")}</Button><Button size="sm" variant="ghost" onClick={() => { onChange({ ...document, nodes: document.nodes.filter((item) => item.id !== node.id), edges: document.edges.filter((edge) => edge.source.nodeId !== node.id && edge.target.nodeId !== node.id), outputs: document.outputs.filter((output) => output.source.nodeId !== node.id) }); onClose?.(); onDelete?.() }}><Trash2 />{tx("workflow.settings.delete")}</Button></>}
    </div>
  </div>
}

export function GraphPorts({ document, types, direction, disabled = false, onChange }: { document: WorkflowDocument; types: NodeTypeDefinition[]; direction: 'inputs' | 'outputs'; disabled?: boolean; onChange(document: WorkflowDocument): void }) {
  const tx = useText(), { language } = useI18n()
  const choices = sources(document, types, language).filter((source) => source.kind === 'artifact' && source.source.nodeId !== INPUTS_ID)
  return <div className="space-y-6 p-4">
    {direction === 'inputs' && <section className="space-y-4">
      {document.inputs.map((input) => <div key={input.id} className="space-y-3 border-b border-border pb-4">
        <div className="flex gap-2"><Input disabled={disabled} aria-label={tx("workflow.settings.input.name")} value={workflowPortLabel(document, input, tx)} onChange={(event) => onChange({ ...document, inputs: document.inputs.map((item) => item.id === input.id ? { ...item, label: event.target.value } : item) })} /><Button disabled={disabled} variant="ghost" size="icon" aria-label={tx("workflow.settings.delete.input")} onClick={() => onChange({ ...document, inputs: document.inputs.filter((item) => item.id !== input.id), edges: document.edges.filter((edge) => edge.source.nodeId !== INPUTS_ID || edge.source.portId !== input.id) })}><Trash2 /></Button></div>
        <NativeSelect disabled={disabled} aria-label={tx("workflow.settings.input.type")} className="w-full" value={input.schemaId} onChange={(event) => onChange({ ...document, inputs: document.inputs.map((item) => item.id === input.id ? { ...item, schemaId: event.target.value, acceptedMimeTypes: event.target.value === 'video/mp4/v1' ? ['video/*'] : event.target.value === 'audio/wav/v1' ? ['audio/*'] : event.target.value === 'file/v1' ? ['*/*'] : ['text/plain', 'application/x-subrip'] } : item) })}><option value="file/v1">{tx("workflow.settings.file")}</option><option value="video/mp4/v1">{tx("workflow.settings.video")}</option><option value="audio/wav/v1">{tx("workflow.settings.audio")}</option><option value="application/x-subrip/v1">{tx("workflow.settings.subtitles")}</option></NativeSelect>
        <Choice disabled={disabled} className="flex items-center gap-2 text-xs" label={tx("workflow.settings.required")} checked={input.required} onChange={(event) => onChange({ ...document, inputs: document.inputs.map((item) => item.id === input.id ? { ...item, required: event.target.checked } : item) })} />
      </div>)}
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange({ ...document, inputs: [...document.inputs, { id: `input-${crypto.randomUUID()}`, label: tx("workflow.settings.video"), kind: 'artifact', schemaId: 'video/mp4/v1', required: true, acceptedMimeTypes: ['video/*'] }] })}><Plus />{tx("workflow.settings.add.input")}</Button>
    </section>}
    {direction === 'outputs' && <section className="space-y-4">
      {document.outputs.map((output) => <div key={output.id} className="space-y-3 border-b border-border pb-4">
        <div className="flex gap-2"><Input disabled={disabled} aria-label={tx("workflow.settings.output.name")} value={workflowPortLabel(document, output, tx)} onChange={(event) => onChange({ ...document, outputs: document.outputs.map((item) => item.id === output.id ? { ...item, label: event.target.value } : item) })} /><Button disabled={disabled} variant="ghost" size="icon" aria-label={tx("workflow.settings.delete.output")} onClick={() => onChange({ ...document, outputs: document.outputs.filter((item) => item.id !== output.id) })}><Trash2 /></Button></div>
        <NativeSelect disabled={disabled} aria-label={tx("workflow.settings.output.source")} className="w-full" value={endpointKey(output.source)} onChange={(event) => { const choice = choices.find((item) => endpointKey(item.source) === event.target.value); if (choice) onChange({ ...document, outputs: document.outputs.map((item) => item.id === output.id ? { ...item, source: choice.source, schemaId: choice.schemaId } : item) }) }}>{choices.map((choice) => <option key={endpointKey(choice.source)} value={endpointKey(choice.source)}>{choice.label}</option>)}</NativeSelect>
      </div>)}
      <Button size="sm" variant="outline" disabled={disabled || !choices.length} onClick={() => { const choice = choices[0]; onChange({ ...document, outputs: [...document.outputs, { id: crypto.randomUUID(), label: choice.label, kind: 'artifact', schemaId: choice.schemaId, required: true, source: choice.source }] }) }}><Plus />{tx("workflow.settings.add.output")}</Button>
    </section>}
  </div>
}
