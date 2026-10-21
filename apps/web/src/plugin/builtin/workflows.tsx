import { Context } from 'cordis'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Download, FolderOpen, GitBranch, Loader2, Play, Plus, Redo2, Save, Search, SlidersHorizontal, Trash2, Undo2, Upload, X } from 'lucide-react'
import { Link, text, useClient, type Diagnostic, type NodeTypeDefinition, type RouteProps, type WorkflowDocument, type WorkflowDocumentRecord } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineAlert } from '@/components/inline-alert'
import { useQuery } from './use-query'
import { WorkflowCanvas, createNode } from './workflow-canvas'
import { GraphPorts, NodeSettings, SynthesizeNodeEditor } from './workflow-settings'
import { blankWorkflow, parseWorkflow, serializeWorkflowEdits, workflowDrafts } from './workflow-utils'
import { useUnsavedChanges } from './workflow-guard'
import { WorkflowRun } from './workflow-run'
import { WorkflowRerun } from './workflow-rerun'
import { TaskNodePage, TaskWorkflowPanel, TranscriptNodeDetails, TranslationNodeDetails } from './workflow-task'
import { useWorkflowDocuments } from './workflow-documents'

function WorkflowLibrary() {
  const tx = useText(), { apiClient, navigation } = useClient()
  const { data, error, refresh } = useWorkflowDocuments()
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function importFile(file: File) {
    setBusy(true); setFailure('')
    try {
      const document = parseWorkflow(await file.text())
      document.id = crypto.randomUUID()
      const record = await apiClient.request<WorkflowDocumentRecord>('/api/v2/workflow-documents', { method: 'POST', body: JSON.stringify({ document }) })
      navigation.push(`/workflows/${record.id}`)
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{tx('Workflows', '工作流', 'ワークフロー')}</h1><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload />{tx('Import', '导入', 'インポート')}</Button><Button onClick={() => navigation.push('/workflows/new')}><Plus />{tx('New workflow', '新建工作流', '新規ワークフロー')}</Button><input ref={input} type="file" accept=".json,.workflow.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} /></div></header>
    {(error || failure) && <InlineAlert>{error || failure}</InlineAlert>}
    {!data && !error && <Loader2 className="size-5 animate-spin" />}
    {(['builtin', 'user', 'plugin'] as const).map((origin) => {
      const items = data?.items.filter((item) => item.origin === origin) ?? []
      if (!items.length) return null
      return <section key={origin} className="space-y-4"><h2 className="font-semibold">{origin === 'builtin' ? tx('Built-in templates', '内置模板', '内蔵テンプレート') : origin === 'user' ? tx('My workflows', '我的工作流', 'マイワークフロー') : tx('Plugin workflows', '插件工作流', 'プラグインワークフロー')}</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card">
        <GitBranch className="mb-4 size-5 text-brand-pink" /><Link href={`/workflows/${item.id}`} className="font-semibold hover:text-link">{item.document.title}</Link><p className="mt-2 text-xs text-muted-foreground">{tx(`${item.document.nodes.length} nodes`, `${item.document.nodes.length} 个节点`, `${item.document.nodes.length} ノード`)}</p>
        <div className="mt-5 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => navigation.push(`/workflows/${item.id}`)}><FolderOpen />{tx('Open', '打开', '開く')}</Button>{origin === 'user' && <Button size="sm" variant={deleting === item.id ? 'destructive' : 'ghost'} disabled={busy} onClick={() => {
          if (deleting !== item.id) { setDeleting(item.id); return }
          setBusy(true); setFailure('')
          void apiClient.request(`/api/v2/workflow-documents/${item.id}?expectedRevision=${item.revision}`, { method: 'DELETE' }).then(refresh).catch((error: Error) => setFailure(error.message)).finally(() => setBusy(false))
        }}><Trash2 />{deleting === item.id ? tx('Confirm delete', '确认删除', '削除を確認') : tx('Delete', '删除', '削除')}</Button>}{deleting === item.id && <Button size="sm" variant="ghost" onClick={() => setDeleting('')}>{tx('Keep', '保留', '保持')}</Button>}</div>
      </article>)}</div></section>
    })}
  </main>
}

function WorkflowRoute({ params }: RouteProps) {
  const tx = useText()
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  useEffect(() => { window.addEventListener('youdub:resources-ready', types.refresh); return () => window.removeEventListener('youdub:resources-ready', types.refresh) }, [types.refresh])
  return <>{types.error ? <div className="p-6"><InlineAlert>{types.error}</InlineAlert></div> : !types.data ? <p className="p-6" role="status">{tx('Loading…', '正在加载…', '読み込み中…')}</p> : params.id === 'new' ? <NewEditor types={types.data.items} nodeId={params.nodeId} /> : <SavedEditor id={params.id} nodeId={params.nodeId} types={types.data.items} />}</>
}
function NewEditor({ types, nodeId }: { types: NodeTypeDefinition[]; nodeId?: string }) {
  const tx = useText()
  const [record] = useState(() => {
    const document = blankWorkflow(); document.title = tx('Untitled workflow', '未命名工作流', '名称未設定')
    return { id: 'new', revision: 0, document, origin: 'user' as const }
  })
  return <Editor initial={record} types={types} nodeId={nodeId} />
}
function SavedEditor({ id, nodeId, types }: { id: string; nodeId?: string; types: NodeTypeDefinition[] }) {
  const tx = useText()
  const { data, error } = useQuery<WorkflowDocumentRecord>(`/api/v2/workflow-documents/${encodeURIComponent(id)}`)
  if (error) return <div className="p-6"><InlineAlert>{error}</InlineAlert></div>
  if (!data) return <p className="p-6" role="status">{tx('Loading…', '正在加载…', '読み込み中…')}</p>
  return <Editor key={id} initial={data} nodeId={nodeId} types={types} />
}

function Editor({ initial, types, nodeId }: { initial: WorkflowDocumentRecord; types: NodeTypeDefinition[]; nodeId?: string }) {
  const tx = useText(), { language } = useI18n(), { apiClient, navigation } = useClient()
  const initialDraft = workflowDrafts.get(initial.id)
  const [sourceTask] = useState(() => new URLSearchParams(window.location.search).get('sourceTask'))
  const sourceQuery = sourceTask ? `?sourceTask=${encodeURIComponent(sourceTask)}` : ''
  const [document, setDocument] = useState<WorkflowDocument>(() => structuredClone(initialDraft?.document ?? initial.document))
  const [saved, setSaved] = useState(initialDraft?.saved ?? serializeWorkflowEdits(initial.document))
  const [revision, setRevision] = useState(initialDraft?.revision ?? initial.revision)
  const [selected, setSelected] = useState<string | undefined>(nodeId), [panel, setPanel] = useState<'nodes' | 'ports' | 'run' | null>(null)
  const [freshInputs, setFreshInputs] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [undo, setUndo] = useState<WorkflowDocument[]>([]), [redo, setRedo] = useState<WorkflowDocument[]>([])
  const dirty = serializeWorkflowEdits(document) !== saved
  const current = useRef(document)
  const history = useRef({ undo, redo })
  useEffect(() => { current.current = document; history.current = { undo, redo } }, [document, undo, redo])
  useEffect(() => { if (initial.id !== 'new' || !revision) workflowDrafts.set(initial.id, { document, saved, revision, origin: initial.origin }) }, [document, saved, revision, initial.id, initial.origin])
  const change = useCallback((next: WorkflowDocument, checkpoint = true) => {
    if (checkpoint) { setUndo((items) => [...items.slice(-99), current.current]); setRedo([]) }
    current.current = next; setDocument(next); setDiagnostics([])
  }, [])
  function undoChange() { const items = history.current.undo; if (items.length) { setRedo((redo) => [current.current, ...redo]); setUndo(items.slice(0, -1)); setDocument(items.at(-1)!); current.current = items.at(-1)! } }
  function redoChange() { const items = history.current.redo; if (items.length) { setUndo((undo) => [...undo, current.current]); setRedo(items.slice(1)); setDocument(items[0]); current.current = items[0] } }
  const guard = useUnsavedChanges(dirty, () => save(), (path) => path.split('?')[0] === `/workflows/${initial.id}` || path.startsWith(`/workflows/${initial.id}/nodes/`), () => { workflowDrafts.delete(initial.id) })
  async function save(copy = false) {
    setBusy(true); setError('')
    try {
      const create = copy || initial.origin !== 'user' || !revision
      const next = create ? { ...current.current, id: crypto.randomUUID(), title: copy || initial.origin !== 'user' ? `${current.current.title} · ${tx('Copy', '副本', 'コピー')}` : current.current.title } : current.current
      const record = await apiClient.request<WorkflowDocumentRecord>(create ? '/api/v2/workflow-documents' : `/api/v2/workflow-documents/${initial.id}`, { method: create ? 'POST' : 'PUT', body: JSON.stringify(create ? { document: next } : { document: next, expectedRevision: revision }) })
      workflowDrafts.delete(initial.id)
      setSaved(serializeWorkflowEdits(record.document)); setRevision(record.revision); setDocument(record.document); current.current = record.document
      if (create) { guard.bypass(); navigation.replace(`/workflows/${record.id}${sourceQuery}`) }
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); throw failure }
    finally { setBusy(false) }
  }
  const actions = useRef({ save, undoChange, redoChange })
  useEffect(() => { actions.current = { save, undoChange, redoChange } })
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void actions.current.save().catch(() => undefined) }
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) actions.current.redoChange(); else actions.current.undoChange() }
    }
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler)
  }, [])
  async function validate() {
    setBusy(true); setError('')
    try { const result = await apiClient.request<{ valid: boolean; diagnostics: Diagnostic[] }>('/api/v2/workflow-documents/validate', { method: 'POST', body: JSON.stringify({ document }) }); setDiagnostics(result.diagnostics); if (result.valid) setPanel('run') }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  function exportFile() {
    const blob = new Blob([JSON.stringify(document, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob), anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = `${document.title.replace(/[\\/:*?"<>|]/g, '-') || 'workflow'}.workflow.json`; anchor.click(); URL.revokeObjectURL(url)
  }
  const openNode = (id: string) => { workflowDrafts.set(initial.id, { document: current.current, saved, revision, origin: initial.origin }); navigation.push(`/workflows/${initial.id}/nodes/${id}${sourceQuery}`) }
  const active = document.nodes.find((node) => node.id === (nodeId ?? selected))
  return <main className={nodeId ? 'mx-auto max-w-5xl space-y-5 px-5 py-8 sm:px-8' : 'flex h-[calc(100dvh-8.5rem)] min-h-[32rem] flex-col lg:h-dvh'}>
    {guard.dialog}
    <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
      <Link href={nodeId ? `/workflows/${initial.id}${sourceQuery}` : '/workflows'} aria-label={tx('Back', '返回', '戻る')} className="rounded-lg p-2 hover:bg-accent"><ArrowLeft className="size-4" /></Link>
      <Input aria-label={tx('Workflow name', '工作流名称', 'ワークフロー名')} className="min-w-32 flex-1 border-0 bg-transparent text-base font-semibold shadow-none sm:max-w-xs" value={document.title} onChange={(event) => change({ ...document, title: event.target.value })} />
      <span className="mr-auto text-xs text-muted-foreground">{dirty ? tx('Unsaved', '未保存', '未保存') : tx('Saved', '已保存', '保存済み')}</span>
      {!nodeId && <><Button size="icon-sm" variant="ghost" disabled={!undo.length} aria-label={tx('Undo', '撤销', '元に戻す')} onClick={undoChange}><Undo2 /></Button><Button size="icon-sm" variant="ghost" disabled={!redo.length} aria-label={tx('Redo', '重做', 'やり直し')} onClick={redoChange}><Redo2 /></Button></>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void save().catch(() => undefined)}><Save />{initial.origin !== 'user' ? tx('Save copy', '保存副本', 'コピーを保存') : tx('Save', '保存', '保存')}</Button>
      {!nodeId && <Button size="sm" disabled={busy} onClick={() => { setSelected(undefined); setPanel('run') }}><Play />{tx('Run', '运行', '実行')}</Button>}
    </header>
    {error && <div className="px-4 py-2"><InlineAlert>{error}</InlineAlert></div>}
    {!!diagnostics.length && <div className="max-h-32 space-y-1 overflow-auto border-b border-border px-4 py-2">{diagnostics.map((item, index) => <button key={index} type="button" className="block text-left text-xs text-status-danger-fg" onClick={() => { if (item.nodeId) { setSelected(item.nodeId); setPanel(null) } }}>{item.message}</button>)}</div>}
    {nodeId ? active ? <section className="rounded-2xl border border-border bg-card"><p className="border-b border-border px-5 py-3 text-sm text-muted-foreground">{tx('Not run yet', '尚未运行', '未実行')}</p><NodeSettings document={document} node={active} types={types} onChange={change} /></section> : <InlineAlert>{tx('Node not found.', '节点不存在。', 'ノードが見つかりません。')}</InlineAlert> : <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Button size="sm" variant={panel === 'nodes' ? 'secondary' : 'ghost'} onClick={() => { setPanel(panel === 'nodes' ? null : 'nodes'); setSelected(undefined) }}><Plus />{tx('Add node', '添加节点', 'ノードを追加')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setPanel(panel === 'ports' ? null : 'ports'); setSelected(undefined) }}><SlidersHorizontal />{tx('Inputs / outputs', '输入 / 输出', '入力 / 出力')}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void validate()}>{tx('Validate', '校验', '検証')}</Button>
        <div className="ml-auto flex gap-1"><Button size="icon-sm" variant="ghost" aria-label={tx('Save as', '另存为', '名前を付けて保存')} disabled={busy} onClick={() => void save(true).catch(() => undefined)}><Copy /></Button><Button size="icon-sm" variant="ghost" aria-label={tx('Export workflow', '导出工作流', 'ワークフローをエクスポート')} onClick={exportFile}><Download /></Button></div>
      </div>
      <div className="workflow-editor-layout flex-1">
        <WorkflowCanvas document={document} types={types} selected={selected} onSelect={(id) => { setSelected(id); setPanel(id?.startsWith('$') ? 'ports' : null) }} onChange={change} onCheckpoint={() => { setUndo((items) => [...items.slice(-99), current.current]); setRedo([]) }} onOpen={openNode} />
        {(panel || active) && <aside className="workflow-inspector">
          {active && !panel ? <NodeSettings document={document} node={active} types={types} onChange={change} onClose={() => setSelected(undefined)} onOpen={() => openNode(active.id)} /> : <>
            <div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-semibold">{panel === 'nodes' ? tx('Nodes', '节点', 'ノード') : panel === 'run' ? tx('Run workflow', '运行工作流', 'ワークフローを実行') : tx('Inputs / outputs', '输入 / 输出', '入力 / 出力')}</h2><Button size="icon-sm" variant="ghost" aria-label={tx('Close panel', '关闭面板', 'パネルを閉じる')} onClick={() => setPanel(null)}><X /></Button></div>
            {panel === 'nodes' && <div className="space-y-4 p-4"><div className="relative"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input aria-label={tx('Search nodes', '搜索节点', 'ノードを検索')} value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" /></div>{types.filter((type) => `${text(type.label, language)} ${type.type} ${type.category}`.toLowerCase().includes(search.toLowerCase())).map((type) => <button type="button" draggable key={`${type.providerId}:${type.type}`} onDragStart={(event) => event.dataTransfer.setData('application/youdub-node', `${type.providerId}:${type.type}`)} className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-accent" onClick={() => { const node = createNode(type); change({ ...document, nodes: [...document.nodes, node], presentation: { ...document.presentation, positions: { ...document.presentation.positions, [node.id]: { x: 320, y: 100 + document.nodes.length * 30 } } } }); setSelected(node.id); setPanel(null) }}><Plus className="size-4 shrink-0 text-brand-blue" /><span className="min-w-0"><span className="block text-sm font-medium">{text(type.label, language)}</span><span className="block truncate text-xs text-muted-foreground">{type.category} · {text(type.provider.label, language) || type.providerId}</span></span></button>)}</div>}
            {panel === 'ports' && <GraphPorts document={document} types={types} onChange={change} />}
            {panel === 'run' && <div className="space-y-5 p-5">{sourceTask && <label className="grid gap-2 text-sm">{tx('Media source', '素材来源', '素材の選択')}<select className="h-10 rounded-lg border border-input bg-input-bg px-3" value={freshInputs ? 'new' : 'existing'} onChange={(event) => setFreshInputs(event.target.value === 'new')}><option value="existing">{tx('Reuse original media', '沿用原素材', '元の素材を再利用')}</option><option value="new">{tx('Choose new media', '选择新素材', '新しい素材を選択')}</option></select></label>}{sourceTask && !freshInputs ? <WorkflowRerun taskId={sourceTask} document={document} types={types} onStarted={() => guard.bypass()} /> : <WorkflowRun document={document} types={types} revision={dirty ? null : revision} onStarted={() => guard.bypass()} />}</div>}
          </>}
        </aside>}
      </div>
    </>}
  </main>
}

export function GraphStudio() {
  const tx = useText()
  const documents = useWorkflowDocuments()
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  useEffect(() => { window.addEventListener('youdub:resources-ready', types.refresh); return () => window.removeEventListener('youdub:resources-ready', types.refresh) }, [types.refresh])
  const [selected, setSelected] = useState('')
  const record = documents.data?.items.find((item) => item.id === selected) ?? documents.data?.items[0]
  if (documents.error || types.error) return <InlineAlert>{documents.error || types.error}</InlineAlert>
  if (!record || !types.data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx('Loading workflows…', '加载工作流…', 'ワークフローを読み込み中…')}</p>
  return <section className="space-y-5 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex min-w-0 flex-1 items-center gap-3 text-sm">{tx('Workflow', '工作流', 'ワークフロー')}<select className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-input-bg px-3" value={record.id} onChange={(event) => setSelected(event.target.value)}>{documents.data!.items.map((item) => <option key={item.id} value={item.id}>{item.document.title}</option>)}</select></label><Link href={`/workflows/${record.id}`} className="text-sm text-link">{tx('Edit workflow', '编辑工作流', 'ワークフローを編集')}</Link></div>
    <WorkflowRun key={record.id} document={record.document} types={types.data.items} revision={record.revision} />
  </section>
}
export const name = 'client-workflows'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('workflow.node.editors', { id: 'youdub.synthesize', component: SynthesizeNodeEditor }))
  ctx.effect(() => ctx.slots.register('workflow.node.details', { id: 'youdub.transcript', component: TranscriptNodeDetails }))
  ctx.effect(() => ctx.slots.register('workflow.node.details', { id: 'youdub.translation', component: TranslationNodeDetails }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflows', path: '/workflows', component: WorkflowLibrary, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflow-editor', path: '/workflows/:id', component: WorkflowRoute, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflow-node', path: '/workflows/:id/nodes/:nodeId', component: WorkflowRoute, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'task-node', path: '/tasks/:id/nodes/:nodeId', component: TaskNodePage, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'workflows', routeId: 'workflows', label: { default: 'Workflows', translations: { zh: '工作流', ja: 'ワークフロー' } }, order: 15, icon: GitBranch }))
  ctx.effect(() => ctx.slots.register('task.detail.panels', { id: 'workflow-graph', order: -10, component: TaskWorkflowPanel }))
}
