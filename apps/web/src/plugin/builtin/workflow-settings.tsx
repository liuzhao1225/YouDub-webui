import type { Bindings } from '../sdk'
import { Component, type ReactNode } from 'react'
import { Copy, ExternalLink, Plus, Trash2, X } from 'lucide-react'
import { Link, text, type GraphNode, type NodeEditorProps, type NodeTypeDefinition, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { ConfigEditor } from './schema-form'
import { canConnect, connect, endpointKey, INPUTS_ID, nodeDefinition, sources } from './workflow-utils'

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
  return <Button variant="outline" onClick={onClick}>{tx('Open read-only view', '打开通用只读视图', '読み取り専用表示を開く')}</Button>
}
export function SynthesizeNodeEditor({ node, definition, readOnly, onChange, useSlot }: NodeEditorProps & Bindings<'useSlot'>) {
  const tx = useText(), { language } = useI18n()
  const model = definition.provider.models?.find((model) => typeof model !== 'string' && model.id === node.provider.model)
  const modes = model && typeof model !== 'string' ? model.voice_modes ?? [] : []
  const voices = model && typeof model !== 'string' ? (model.voices ?? []).filter((voice) => !voice.languages || voice.languages.includes(String(node.config.targetLanguage))) : []
  const voice = node.config.voice as { mode?: string; id?: string } | undefined
  const properties = Object.fromEntries(Object.entries(definition.configSchema.properties ?? {}).filter(([name]) => name !== 'voice'))
  return <div className="space-y-5">
    <ConfigEditor useSlot={useSlot} ownerId="youdub.synthesize.options" value={node.config} schema={{ ...definition.configSchema, properties, required: definition.configSchema.required?.filter((name) => name !== 'voice') }} diagnostics={[]} readOnly={readOnly} onChange={(config) => onChange({ ...node, config })} />
    <label className="grid gap-2 text-sm">{tx('Voice mode', '声音模式', '音声モード')}<select className="h-10 min-w-0 rounded-lg border border-input bg-input-bg px-3" disabled={readOnly || !modes.length} value={voice?.mode ?? ''} onChange={(event) => onChange({ ...node, config: { ...node.config, voice: { mode: event.target.value } } })}>
      {!modes.includes(voice?.mode ?? '') && <option value={voice?.mode ?? ''}>{voice?.mode === 'source_clone' ? tx('Source voice clone', '原声克隆', '元の声を複製') : tx('Choose a model first', '先选择模型', '先にモデルを選択')}</option>}
      {modes.map((mode) => <option key={mode} value={mode}>{mode === 'source_clone' ? tx('Source voice clone', '原声克隆', '元の声を複製') : mode === 'preset' ? tx('Preset voice', '预设声线', 'プリセット音声') : mode}</option>)}
    </select></label>
    {voice?.mode === 'preset' && <label className="grid gap-2 text-sm">{tx('Voice', '声线', '音声')}<select disabled={readOnly} className="h-10 min-w-0 rounded-lg border border-input bg-input-bg px-3" value={voice.id ?? ''} onChange={(event) => onChange({ ...node, config: { ...node.config, voice: { mode: 'preset', id: event.target.value } } })}><option value="">{tx('Choose voice', '选择声线', '音声を選択')}</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{text(voice.label, language) || voice.id}</option>)}</select></label>}
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
  const compatibleProviders = types.filter((type) => type.type === node.type && type.version === node.typeVersion)
  const models = definition?.provider.models ?? []
  const model = models.find((item) => (typeof item === 'string' ? item : item.id) === node.provider.model)
  const generic = <ConfigEditor useSlot={useSlot} ownerId={`node:${node.type}`} value={node.config} schema={definition?.configSchema ?? { type: 'object' }} readOnly={readOnly} diagnostics={[]} onChange={(config) => replace({ ...node, config })} />
  return <div className="space-y-5 p-5">
    <div className="flex items-center gap-2"><h2 className="min-w-0 flex-1 truncate font-semibold">{node.label || text(definition?.label, language) || node.type}</h2>{onClose && <Button disabled={readOnly} variant="ghost" size="icon-sm" aria-label={tx('Close settings', '关闭设置', '設定を閉じる')} onClick={onClose}><X /></Button>}</div>
    {!definition && <InlineAlert>{tx('The required node plugin or version is unavailable.', '所需节点插件或版本不可用。', '必要なノードプラグインまたはバージョンがありません。')}</InlineAlert>}
    <label className="grid gap-2 text-sm">{tx('Name', '名称', '名前')}<Input disabled={readOnly} value={node.label ?? ''} placeholder={text(definition?.label, language) || node.type} onChange={(event) => replace({ ...node, label: event.target.value })} /></label>
    <label className="grid gap-2 text-sm">{tx('Provider', '服务', 'プロバイダー')}<select className="h-10 min-w-0 rounded-lg border border-input bg-input-bg px-3" disabled={readOnly} value={node.provider.id} onChange={(event) => replace({ ...node, provider: { id: event.target.value } })}>{!compatibleProviders.length && <option>{node.provider.id}</option>}{compatibleProviders.map((type) => <option key={type.providerId} value={type.providerId}>{text(type.provider.label, language) || type.providerId}</option>)}</select></label>
    {models.length > 0 && <label className="grid gap-2 text-sm">{tx('Model', '模型', 'モデル')}<select className="h-10 min-w-0 rounded-lg border border-input bg-input-bg px-3" disabled={readOnly} value={node.provider.model ?? ''} onChange={(event) => replace({ ...node, provider: { ...node.provider, model: event.target.value } })}><option value="">{tx('Choose model', '选择模型', 'モデルを選択')}</option>{models.map((item) => <option key={typeof item === 'string' ? item : item.id} value={typeof item === 'string' ? item : item.id}>{typeof item === 'string' ? item : item.id}</option>)}</select></label>}
    {definition?.provider.capability === 'translation' && !models.length && <div className="space-y-2"><label className="grid gap-2 text-sm">{tx('Model', '模型', 'モデル')}<Input disabled={readOnly} value={node.provider.model ?? ''} onChange={(event) => replace({ ...node, provider: { ...node.provider, model: event.target.value } })} /></label><Link href="/settings" className="text-xs text-link">{tx('Configure connection', '配置翻译连接', '接続を設定')}</Link></div>}
    {model && typeof model !== 'string' && model.devices?.length && <label className="grid gap-2 text-sm">{tx('Device', '设备', 'デバイス')}<select disabled={readOnly} className="h-10 rounded-lg border border-input bg-input-bg px-3" value={node.provider.device ?? ''} onChange={(event) => replace({ ...node, provider: { ...node.provider, device: event.target.value } })}><option value="">—</option>{model.devices.map((device) => <option key={device}>{device}</option>)}</select></label>}
    {definition && (Custom ? <NodePluginBoundary key={node.type} fallback={<pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(node.config, null, 2)}</pre>}><Custom node={node} definition={definition} diagnostics={[]} readOnly={readOnly} onChange={replace} /></NodePluginBoundary> : definition.ui?.editorId ? <InlineAlert>{tx('Node editor plugin is unavailable.', '节点配置编辑器不可用。', 'ノードエディターがありません。')} {definition.ui.editorId}</InlineAlert> : generic)}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" disabled={readOnly} checked={node.autoContinue} onChange={(event) => replace({ ...node, autoContinue: event.target.checked })} />{tx('Auto continue', '自动下一步', '自動で次へ')}</label>
    {!node.autoContinue && <p className="text-xs text-muted-foreground">{tx('Pause after this node until its result is approved.', '此节点完成后暂停，确认结果后继续。', 'このノードの結果を確認するまで一時停止します。')}</p>}
    {!!definition?.inputs.length && <section className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">{tx('Input sources', '输入来源', '入力元')}</h3>
      {definition.inputs.map((input) => {
        const current = document.edges.find((edge) => edge.target.nodeId === node.id && edge.target.portId === input.id)
        const choices = sources(document, types, language).filter((source) => canConnect(document, types, source.source, { nodeId: node.id, portId: input.id }))
        return <label key={input.id} className="grid gap-1.5 text-xs">{text(input.label, language)}{input.required ? ' *' : ''}<select disabled={readOnly} className="h-9 min-w-0 rounded-lg border border-input bg-input-bg px-2" value={current ? endpointKey(current.source) : ''} onChange={(event) => {
          if (!event.target.value) onChange({ ...document, edges: document.edges.filter((edge) => edge !== current) })
          else { const [nodeId, portId] = JSON.parse(event.target.value) as [string, string]; onChange(connect(document, { nodeId, portId }, { nodeId: node.id, portId: input.id })) }
        }}><option value="">{tx('Not connected', '未连接', '未接続')}</option>{choices.map((choice) => <option key={endpointKey(choice.source)} value={endpointKey(choice.source)}>{choice.label}</option>)}</select></label>
      })}
    </section>}
    <div className="flex flex-wrap gap-2 border-t border-border pt-4">
      {onOpen && <Button size="sm" variant="outline" disabled={readOnly} onClick={onOpen}><ExternalLink />{tx('Full settings', '完整设置', '詳細設定')}</Button>}
      {!readOnly && <><Button size="sm" variant="outline" onClick={() => { const id = crypto.randomUUID(); onChange({ ...document, nodes: [...document.nodes, { ...structuredClone(node), id }], presentation: { ...document.presentation, positions: { ...document.presentation.positions, [id]: { x: (document.presentation.positions[node.id]?.x ?? 0) + 40, y: (document.presentation.positions[node.id]?.y ?? 0) + 80 } } } }) }}><Copy />{tx('Duplicate', '复制', '複製')}</Button><Button size="sm" variant="ghost" onClick={() => { onChange({ ...document, nodes: document.nodes.filter((item) => item.id !== node.id), edges: document.edges.filter((edge) => edge.source.nodeId !== node.id && edge.target.nodeId !== node.id), outputs: document.outputs.filter((output) => output.source.nodeId !== node.id) }); onClose?.(); onDelete?.() }}><Trash2 />{tx('Delete', '删除', '削除')}</Button></>}
    </div>
  </div>
}

export function GraphPorts({ document, types, onChange }: { document: WorkflowDocument; types: NodeTypeDefinition[]; onChange(document: WorkflowDocument): void }) {
  const tx = useText(), { language } = useI18n()
  const choices = sources(document, types, language).filter((source) => source.kind === 'artifact' && source.source.nodeId !== INPUTS_ID)
  return <div className="space-y-6 p-5">
    <section className="space-y-4"><h2 className="font-semibold">{tx('Workflow inputs', '工作流输入', 'ワークフロー入力')}</h2>
      {document.inputs.map((input) => <div key={input.id} className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex gap-2"><Input aria-label={tx('Input name', '输入名称', '入力名')} value={input.label} onChange={(event) => onChange({ ...document, inputs: document.inputs.map((item) => item.id === input.id ? { ...item, label: event.target.value } : item) })} /><Button variant="ghost" size="icon" aria-label={tx('Delete input', '删除输入', '入力を削除')} onClick={() => onChange({ ...document, inputs: document.inputs.filter((item) => item.id !== input.id), edges: document.edges.filter((edge) => edge.source.nodeId !== INPUTS_ID || edge.source.portId !== input.id) })}><Trash2 /></Button></div>
        <select aria-label={tx('Input type', '输入类型', '入力の型')} className="h-9 w-full rounded-lg border border-input bg-input-bg px-2 text-xs" value={input.schemaId} onChange={(event) => onChange({ ...document, inputs: document.inputs.map((item) => item.id === input.id ? { ...item, schemaId: event.target.value, acceptedMimeTypes: event.target.value === 'video/mp4/v1' ? ['video/*'] : event.target.value === 'audio/wav/v1' ? ['audio/*'] : event.target.value === 'file/v1' ? ['*/*'] : ['text/plain', 'application/x-subrip'] } : item) })}><option value="file/v1">{tx('File', '文件', 'ファイル')}</option><option value="video/mp4/v1">{tx('Video', '视频', '動画')}</option><option value="audio/wav/v1">{tx('Audio', '音频', '音声')}</option><option value="application/x-subrip/v1">{tx('Subtitles', '字幕', '字幕')}</option></select>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={input.required} onChange={(event) => onChange({ ...document, inputs: document.inputs.map((item) => item.id === input.id ? { ...item, required: event.target.checked } : item) })} />{tx('Required', '必填', '必須')}</label>
      </div>)}
      <Button size="sm" variant="outline" onClick={() => onChange({ ...document, inputs: [...document.inputs, { id: `input-${crypto.randomUUID()}`, label: tx('Video', '视频', '動画'), kind: 'artifact', schemaId: 'video/mp4/v1', required: true, acceptedMimeTypes: ['video/*'], maxBytes: 4 * 1024 ** 3 }] })}><Plus />{tx('Add input', '添加输入', '入力を追加')}</Button>
    </section>
    <section className="space-y-4 border-t border-border pt-5"><h2 className="font-semibold">{tx('Generated files', '输出文件', '出力ファイル')}</h2>
      {document.outputs.map((output) => <div key={output.id} className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex gap-2"><Input aria-label={tx('Output name', '输出名称', '出力名')} value={output.label} onChange={(event) => onChange({ ...document, outputs: document.outputs.map((item) => item.id === output.id ? { ...item, label: event.target.value } : item) })} /><Button variant="ghost" size="icon" aria-label={tx('Delete output', '删除输出', '出力を削除')} onClick={() => onChange({ ...document, outputs: document.outputs.filter((item) => item.id !== output.id) })}><Trash2 /></Button></div>
        <select aria-label={tx('Output source', '输出来源', '出力元')} className="h-9 w-full rounded-lg border border-input bg-input-bg px-2 text-xs" value={endpointKey(output.source)} onChange={(event) => { const choice = choices.find((item) => endpointKey(item.source) === event.target.value); if (choice) onChange({ ...document, outputs: document.outputs.map((item) => item.id === output.id ? { ...item, source: choice.source, schemaId: choice.schemaId } : item) }) }}>{choices.map((choice) => <option key={endpointKey(choice.source)} value={endpointKey(choice.source)}>{choice.label}</option>)}</select>
      </div>)}
      <Button size="sm" variant="outline" disabled={!choices.length} onClick={() => { const choice = choices[0]; onChange({ ...document, outputs: [...document.outputs, { id: crypto.randomUUID(), label: choice.label, kind: 'artifact', schemaId: choice.schemaId, required: true, source: choice.source }] }) }}><Plus />{tx('Add output', '添加输出', '出力を追加')}</Button>
    </section>
  </div>
}
