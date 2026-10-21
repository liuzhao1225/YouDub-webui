import { bindComponent, type Bindings } from '../sdk'
import { Context } from 'cordis'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, Download, GitBranch, Loader2, Pencil, Play, Plus, Redo2, Save, Search, SlidersHorizontal, Trash2, Undo2, Upload, X } from 'lucide-react'
import { Link, text, type Diagnostic, type JsonObject, type NodeTypeDefinition, type RouteProps, type WorkflowDocument, type WorkflowDocumentRecord, type WorkflowDescription } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Page, PageHeader } from '@/components/page-layout'
import { Input } from '@/components/ui/input'
import { InlineAlert } from '@/components/inline-alert'
import { WorkflowCanvas } from './workflow-canvas'
import { GraphPorts, NodeSettings, SynthesizeNodeEditor } from './workflow-settings'
import { blankWorkflow, parseWorkflow, serializeWorkflowEdits, workflowDrafts } from './workflow-utils'
import { useUnsavedChanges } from './workflow-guard'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { WorkflowOptions, optionPillClassName } from './workflow-options'
import { WorkflowRun, type WorkflowRunDraft } from './workflow-run'
import { WorkflowRerun } from './workflow-rerun'
import { WorkflowDiagnostics } from './workflow-errors'
import { TaskNodePage, TaskWorkflowPanel, TranscriptNodeDetails, TranslationNodeDetails } from './workflow-task'

function WorkflowLibrary({ request, navigate, useWorkflowDocuments }: Bindings<'request' | 'navigate' | 'useWorkflowDocuments'>) {
  const tx = useText()
  const { data, error, refresh } = useWorkflowDocuments()
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function importFile(file: File) {
    setBusy(true); setFailure('')
    try {
      const document = parseWorkflow(await file.text())
      document.id = crypto.randomUUID()
      const record = await request<WorkflowDocumentRecord>('/api/v2/workflow-documents', { method: 'POST', body: JSON.stringify({ document }) })
      navigate(`/workflows/${record.id}`)
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  return <Page>
    <PageHeader title={tx('Workflows', '工作流', 'ワークフロー')} actions={<><Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload />{tx('Import', '导入', 'インポート')}</Button><Button onClick={() => navigate('/workflows/new')}><Plus />{tx('New workflow', '新建工作流', '新規ワークフロー')}</Button><input ref={input} type="file" accept=".json,.workflow.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} /></>} />
    {(error || failure) && <InlineAlert>{error || failure}</InlineAlert>}
    {error && <Button variant="outline" onClick={refresh}>{tx('Retry', '重试', '再試行')}</Button>}
    {!data && !error && <Loader2 className="size-5 animate-spin" />}
    {data && !data.items.length && <p className="text-sm text-muted-foreground">{tx('No workflows available', '暂无工作流', 'ワークフローがありません')}</p>}
    {(['builtin', 'user', 'plugin'] as const).map((origin) => {
      const items = data?.items.filter((item) => item.origin === origin) ?? []
      if (!items.length) return null
      return <section key={origin} className="space-y-4"><h2 className="font-semibold">{origin === 'builtin' ? tx('Built-in templates', '内置模板', '内蔵テンプレート') : origin === 'user' ? tx('My workflows', '我的工作流', 'マイワークフロー') : tx('Plugin workflows', '插件工作流', 'プラグインワークフロー')}</h2><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <article key={item.id} className="flex flex-col rounded-2xl border border-border bg-card p-5 shadow-card">
        <GitBranch className="mb-4 size-5 text-brand-pink" /><Link href={`/workflows/${item.id}`} className="font-semibold hover:text-link">{item.document.title}</Link><p className="mt-2 text-xs text-muted-foreground">{tx(`${item.document.nodes.length} nodes`, `${item.document.nodes.length} 个节点`, `${item.document.nodes.length} ノード`)}</p>
        <div className="mt-5 flex flex-wrap gap-2"><Button size="sm" onClick={() => navigate(`/workflows/${encodeURIComponent(item.id)}?run=1`)}><Play />{tx('Use', '使用', '使う')}</Button><Button size="sm" variant="outline" onClick={() => navigate(`/workflows/${encodeURIComponent(item.id)}`)}><Pencil />{tx('Edit', '编辑', '編集')}</Button>{origin === 'user' && <Button size="sm" variant={deleting === item.id ? 'destructive' : 'ghost'} disabled={busy} onClick={() => {
          if (deleting !== item.id) { setDeleting(item.id); return }
          setBusy(true); setFailure('')
          void request(`/api/v2/workflow-documents/${item.id}?expectedRevision=${item.revision}`, { method: 'DELETE' }).then(refresh).catch((error: Error) => setFailure(error.message)).finally(() => setBusy(false))
        }}><Trash2 />{deleting === item.id ? tx('Confirm delete', '确认删除', '削除を確認') : tx('Delete', '删除', '削除')}</Button>}{deleting === item.id && <Button size="sm" variant="ghost" onClick={() => setDeleting('')}>{tx('Keep', '保留', '保持')}</Button>}</div>
      </article>)}</div></section>
    })}
  </Page>
}

function WorkflowRoute({ params, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: RouteProps & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText()
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  useEffect(() => { window.addEventListener('youdub:resources-ready', types.refresh); return () => window.removeEventListener('youdub:resources-ready', types.refresh) }, [types.refresh])
  return <>{types.error && <Page as="div" className={params.nodeId ? undefined : 'max-w-none'}><InlineAlert>{types.error}</InlineAlert>{!types.data && <Button variant="outline" onClick={types.refresh}>{tx('Retry', '重试', '再試行')}</Button>}</Page>}{!types.data ? !types.error && <Page as="div" className={params.nodeId ? undefined : 'max-w-none'}><p role="status">{tx('Loading…', '正在加载…', '読み込み中…')}</p></Page> : params.id === 'new' ? <NewEditor useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} types={types.data.items} nodeId={params.nodeId} /> : <SavedEditor useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} id={params.id} nodeId={params.nodeId} types={types.data.items} />}</>
}
function NewEditor({ types, nodeId, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: { types: NodeTypeDefinition[]; nodeId?: string } & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText()
  const [record] = useState(() => {
    const document = blankWorkflow(); document.title = tx('Untitled workflow', '未命名工作流', '名称未設定')
    return { id: 'new', revision: 0, document, origin: 'user' as const }
  })
  return <Editor useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} initial={record} types={types} nodeId={nodeId} />
}
function SavedEditor({ id, nodeId, types, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: { id: string; nodeId?: string; types: NodeTypeDefinition[] } & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText()
  const { data, error, refresh } = useQuery<WorkflowDocumentRecord>(`/api/v2/workflow-documents/${encodeURIComponent(id)}`)
  if (error) return <Page className={nodeId ? undefined : 'max-w-none'}><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx('Retry', '重试', '再試行')}</Button></Page>
  if (!data) return <Page className={nodeId ? undefined : 'max-w-none'}><p role="status">{tx('Loading…', '正在加载…', '読み込み中…')}</p></Page>
  return <Editor useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} key={id} initial={data} nodeId={nodeId} types={types} />
}

function Editor({ initial, types, nodeId, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: { initial: WorkflowDocumentRecord; types: NodeTypeDefinition[]; nodeId?: string } & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText(), { language } = useI18n()
  const initialDraft = workflowDrafts.get(initial.id)
  const [sourceTask] = useState(() => new URLSearchParams(window.location.search).get('sourceTask'))
  const sourceQuery = sourceTask ? `?sourceTask=${encodeURIComponent(sourceTask)}` : ''
  const [document, setDocument] = useState<WorkflowDocument>(() => structuredClone(initialDraft?.document ?? initial.document))
  const [saved, setSaved] = useState(initialDraft?.saved ?? serializeWorkflowEdits(initial.document))
  const [revision, setRevision] = useState(initialDraft?.revision ?? initial.revision)
  const [selected, setSelected] = useState<string | undefined>(nodeId), [panel, setPanel] = useState<'nodes' | 'ports' | 'run' | null>(() => new URLSearchParams(window.location.search).get('run') === '1' ? 'run' : initial.id === 'new' && !initialDraft?.document.nodes.length ? 'nodes' : null)
  const [freshInputs, setFreshInputs] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [validated, setValidated] = useState(false)
  const [undo, setUndo] = useState<WorkflowDocument[]>(initialDraft?.undo ?? []), [redo, setRedo] = useState<WorkflowDocument[]>(initialDraft?.redo ?? [])
  const [fitOnLoad] = useState(!initialDraft?.canvasViewed)
  const canvasViewed = useRef(initialDraft?.canvasViewed ?? false)
  const addAtCenter = useRef<((type: NodeTypeDefinition) => void) | null>(null)
  const [runLocked, setRunLocked] = useState(false)
  const runLock = useRef(false), allowLeave = useRef(false)
  const onRunLockChange = useCallback((locked: boolean) => { runLock.current = locked; setRunLocked(locked) }, [])
  const blockedMessage = tx('Finish checking or clearing this submission before leaving.', '请先完成本次提交、查询结果或清理导入。', '送信結果の確認またはインポートの削除を完了してください。')
  const lockMessage = useRef(blockedMessage)
  useEffect(() => { lockMessage.current = blockedMessage }, [blockedMessage])
  useEffect(() => {
    const remove = blockNavigation(async () => {
      if (!runLock.current || allowLeave.current) return true
      setError(lockMessage.current); return false
    })
    const unload = (event: BeforeUnloadEvent) => { if (runLock.current && !allowLeave.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { remove?.(); window.removeEventListener('beforeunload', unload) }
  }, [blockNavigation])
  const editingLocked = busy || runLocked
  const dirty = serializeWorkflowEdits(document) !== saved
  const current = useRef(document)
  const history = useRef({ undo, redo })
  useEffect(() => { current.current = document; history.current = { undo, redo } }, [document, undo, redo])
  useEffect(() => { if (initial.id !== 'new' || !revision) workflowDrafts.set(initial.id, { document, saved, revision, origin: initial.origin, undo, redo, canvasViewed: canvasViewed.current }) }, [document, saved, revision, initial.id, initial.origin, undo, redo])
  const change = useCallback((next: WorkflowDocument, checkpoint = true) => {
    if (runLock.current || JSON.stringify(next) === JSON.stringify(current.current)) return
    if (checkpoint) {
      const previous = current.current
      const nextUndo = [...history.current.undo.slice(-99), previous]
      history.current = { undo: nextUndo, redo: [] }; setUndo(nextUndo); setRedo([])
    }
    current.current = next; setDocument(next); setDiagnostics([]); setValidated(false)
  }, [])
  function undoChange() { const items = history.current.undo; if (!editingLocked && items.length) { const nextHistory = { undo: items.slice(0, -1), redo: [current.current, ...history.current.redo] }; history.current = nextHistory; setRedo(nextHistory.redo); setUndo(nextHistory.undo); setDocument(items.at(-1)!); current.current = items.at(-1)!; setValidated(false); setDiagnostics([]) } }
  function redoChange() { const items = history.current.redo; if (!editingLocked && items.length) { const nextHistory = { undo: [...history.current.undo, current.current], redo: items.slice(1) }; history.current = nextHistory; setUndo(nextHistory.undo); setRedo(nextHistory.redo); setDocument(items[0]); current.current = items[0]; setValidated(false); setDiagnostics([]) } }
  const guard = useUnsavedChanges(blockNavigation, dirty, () => save(), (path) => path.split('?')[0] === `/workflows/${initial.id}` || path.startsWith(`/workflows/${initial.id}/nodes/`), () => { workflowDrafts.delete(initial.id) })
  async function save(copy = false) {
    if (editingLocked || (initial.origin === 'user' && revision > 0 && !dirty && !copy)) return
    setBusy(true); setError('')
    try {
      const create = copy || initial.origin !== 'user' || !revision
      const next = create ? { ...current.current, id: crypto.randomUUID(), title: copy || initial.origin !== 'user' ? `${current.current.title} · ${tx('Copy', '副本', 'コピー')}` : current.current.title } : current.current
      const record = await request<WorkflowDocumentRecord>(create ? '/api/v2/workflow-documents' : `/api/v2/workflow-documents/${initial.id}`, { method: create ? 'POST' : 'PUT', body: JSON.stringify(create ? { document: next } : { document: next, expectedRevision: revision }) })
      workflowDrafts.delete(initial.id)
      setSaved(serializeWorkflowEdits(record.document)); setRevision(record.revision); setDocument(record.document); current.current = record.document
      if (create) { guard.bypass(); replace(`/workflows/${record.id}${sourceQuery}`) }
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
    setBusy(true); setError(''); setValidated(false)
    try { const result = await request<{ valid: boolean; diagnostics: Diagnostic[] }>('/api/v2/workflow-documents/validate', { method: 'POST', body: JSON.stringify({ document }) }); setDiagnostics(result.diagnostics); setValidated(result.valid) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  function exportFile() {
    const blob = new Blob([JSON.stringify(document, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob), anchor = window.document.createElement('a')
    anchor.href = url; anchor.download = `${document.title.replace(/[\\/:*?"<>|]/g, '-') || 'workflow'}.workflow.json`; anchor.click(); URL.revokeObjectURL(url)
  }
  const openNode = (id: string) => { if (runLock.current) return; workflowDrafts.set(initial.id, { document: current.current, saved, revision, origin: initial.origin, ...history.current, canvasViewed: canvasViewed.current }); navigate(`/workflows/${initial.id}/nodes/${id}${sourceQuery}`) }
  const onStarted = () => { allowLeave.current = true; guard.bypass() }
  const active = document.nodes.find((node) => node.id === (nodeId ?? selected))
  const visibleTypes = types.filter((type) => `${text(type.label, language)} ${type.type} ${type.category}`.toLowerCase().includes(search.toLowerCase()))
  const Layout = nodeId ? Page : 'main'
  return <Layout className={nodeId ? undefined : 'flex h-[calc(100dvh-8.5rem)] min-h-[32rem] flex-col lg:h-dvh'}>
    {guard.dialog}
    <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
      <Button size="icon-sm" variant="ghost" disabled={editingLocked} aria-label={tx('Back', '返回', '戻る')} onClick={() => navigate(nodeId ? `/workflows/${initial.id}${sourceQuery}` : '/workflows')}><ArrowLeft className="size-4" /></Button>
      <Input aria-label={tx('Workflow name', '工作流名称', 'ワークフロー名')} disabled={editingLocked} className="min-w-32 flex-1 border-0 bg-transparent text-base font-semibold shadow-none sm:max-w-xs" value={document.title} onChange={(event) => change({ ...document, title: event.target.value })} />
      <span className="mr-auto text-xs text-muted-foreground">{dirty ? tx('Unsaved', '未保存', '未保存') : initial.origin !== 'user' ? tx('Template', '模板', 'テンプレート') : revision ? tx('Saved', '已保存', '保存済み') : tx('Draft', '草稿', '下書き')}</span>
      <Button size="icon-sm" variant="ghost" disabled={editingLocked || !undo.length} aria-label={tx('Undo', '撤销', '元に戻す')} onClick={undoChange}><Undo2 /></Button><Button size="icon-sm" variant="ghost" disabled={editingLocked || !redo.length} aria-label={tx('Redo', '重做', 'やり直し')} onClick={redoChange}><Redo2 /></Button>
      <Button size="sm" variant="outline" disabled={editingLocked || (initial.origin === 'user' && revision > 0 && !dirty)} onClick={() => void save().catch(() => undefined)}><Save />{initial.origin !== 'user' ? tx('Save copy', '保存副本', 'コピーを保存') : tx('Save', '保存', '保存')}</Button>
      {!nodeId && <Button size="sm" disabled={editingLocked || !document.nodes.length} onClick={() => { setSelected(undefined); setPanel('run') }}><Play />{tx('Run', '运行', '実行')}</Button>}
    </header>
    {error && <div className="px-4 py-2"><InlineAlert>{error}</InlineAlert></div>}
    {!!diagnostics.length && <div className="max-h-48 space-y-2 overflow-auto border-b border-border px-4 py-2"><WorkflowDiagnostics diagnostics={diagnostics} document={document} types={types} disabled={editingLocked} onSelect={(item) => { if (item.nodeId) { setSelected(item.nodeId); setPanel(null) } }} /></div>}
    {validated && <p role="status" className="border-b border-border px-4 py-2 text-xs text-status-success-fg">{tx('Workflow valid', '校验通过', '検証に成功しました')}</p>}
    {nodeId ? active ? <section className="rounded-2xl border border-border bg-card"><NodeSettings useSlot={useSlot} document={document} node={active} types={types} readOnly={editingLocked} onChange={change} onDelete={() => { workflowDrafts.set(initial.id, { document: current.current, saved, revision, origin: initial.origin, ...history.current, canvasViewed: canvasViewed.current }); navigate(`/workflows/${initial.id}${sourceQuery}`) }} /></section> : <InlineAlert>{tx('Node not found.', '节点不存在。', 'ノードが見つかりません。')}</InlineAlert> : <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Button size="sm" disabled={editingLocked} variant={panel === 'nodes' ? 'secondary' : 'ghost'} onClick={() => { setPanel(panel === 'nodes' ? null : 'nodes'); setSelected(undefined) }}><Plus />{tx('Add node', '添加节点', 'ノードを追加')}</Button>
        <Button size="sm" disabled={editingLocked} variant={panel === 'ports' ? 'secondary' : 'ghost'} onClick={() => { setPanel(panel === 'ports' ? null : 'ports'); setSelected(undefined) }}><SlidersHorizontal />{tx('Inputs / outputs', '输入 / 输出', '入力 / 出力')}</Button>
        <Button size="sm" variant="ghost" disabled={editingLocked} onClick={() => void validate()}>{tx('Validate', '校验', '検証')}</Button>
        <div className="ml-auto flex gap-1">{initial.origin === 'user' && revision > 0 && <Button size="icon-sm" variant="ghost" aria-label={tx('Save as', '另存为', '名前を付けて保存')} disabled={editingLocked} onClick={() => void save(true).catch(() => undefined)}><Copy /></Button>}<Button size="icon-sm" variant="ghost" disabled={editingLocked} aria-label={tx('Export workflow', '导出工作流', 'ワークフローをエクスポート')} onClick={exportFile}><Download /></Button></div>
      </div>
      <div className="workflow-editor-layout flex-1">
        <WorkflowCanvas document={document} types={types} selected={selected} disabled={editingLocked} fitOnLoad={fitOnLoad} addNodeRef={addAtCenter} onReady={() => { canvasViewed.current = true; const draft = workflowDrafts.get(initial.id); if (draft) draft.canvasViewed = true }} onSelect={(id) => { if (!runLock.current) { setSelected(id); setPanel(id?.startsWith('$') ? 'ports' : null) } }} onChange={change} onCheckpoint={() => { if (!runLock.current) { const nextUndo = [...history.current.undo.slice(-99), current.current]; history.current = { undo: nextUndo, redo: [] }; setUndo(nextUndo); setRedo([]) } }} onOpen={openNode} />
        {(panel || active) && <aside className="workflow-inspector">
          {active && !panel ? <NodeSettings useSlot={useSlot} document={document} node={active} types={types} readOnly={editingLocked} onChange={change} onClose={() => setSelected(undefined)} onOpen={() => openNode(active.id)} /> : <>
            <div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-semibold">{panel === 'nodes' ? tx('Nodes', '节点', 'ノード') : panel === 'run' ? tx('Run workflow', '运行工作流', 'ワークフローを実行') : tx('Inputs / outputs', '输入 / 输出', '入力 / 出力')}</h2><Button size="icon-sm" variant="ghost" disabled={editingLocked} aria-label={tx('Close panel', '关闭面板', 'パネルを閉じる')} onClick={() => setPanel(null)}><X /></Button></div>
            {panel === 'nodes' && <div className="space-y-4 p-4"><div className="relative"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input aria-label={tx('Search nodes', '搜索节点', 'ノードを検索')} value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" /></div>{!visibleTypes.length && <p className="text-sm text-muted-foreground">{tx('No nodes found', '未找到节点', 'ノードが見つかりません')}</p>}{visibleTypes.map((type) => <button type="button" draggable key={`${type.providerId}:${type.type}`} onDragStart={(event) => event.dataTransfer.setData('application/youdub-node', `${type.providerId}:${type.type}`)} className="flex w-full items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-accent" disabled={editingLocked} onClick={() => { if (addAtCenter.current) addAtCenter.current(type); else setError(tx('The canvas is still loading.', '画布正在加载。', 'キャンバスを読み込み中です。')) }}><Plus className="size-4 shrink-0 text-brand-blue" /><span className="min-w-0"><span className="block text-sm font-medium">{text(type.label, language)}</span><span className="block truncate text-xs text-muted-foreground">{text(type.provider.label, language) || type.providerId}</span></span></button>)}</div>}
            {panel === 'ports' && <fieldset disabled={editingLocked}><GraphPorts document={document} types={types} onChange={change} /></fieldset>}
            {panel === 'run' && <div className="space-y-5 p-5">{sourceTask && <label className="grid gap-2 text-sm">{tx('Media source', '素材来源', '素材の選択')}<select disabled={editingLocked} className="h-10 rounded-lg border border-input bg-input-bg px-3" value={freshInputs ? 'new' : 'existing'} onChange={(event) => setFreshInputs(event.target.value === 'new')}><option value="existing">{tx('Reuse original media', '沿用原素材', '元の素材を再利用')}</option><option value="new">{tx('Choose new media', '选择新素材', '新しい素材を選択')}</option></select></label>}{sourceTask && !freshInputs ? <WorkflowRerun useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useQuery={useQuery} useSlot={useSlot} taskId={sourceTask} document={document} types={types} onStarted={onStarted} onLockChange={onRunLockChange} /> : <WorkflowRun useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useSlot={useSlot} document={document} types={types} revision={dirty ? null : revision} onStarted={onStarted} onLockChange={onRunLockChange} />}</div>}
          </>}
        </aside>}
      </div>
    </>}
  </Layout>
}

export function GraphStudio({ onLockChange, additionalWorkflows = [], renderWorkflow, request, navigate, useQuery, useSlot, useWorkflowDocuments, useWorkflowResources }: { onLockChange?(locked: boolean): void; additionalWorkflows?: WorkflowDescription[]; renderWorkflow?(workflow: WorkflowDescription, selector: ReactNode, onLockChange: (locked: boolean) => void): ReactNode } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot' | 'useWorkflowDocuments' | 'useWorkflowResources'>) {
  const tx = useText(), { language } = useI18n()
  const documents = useWorkflowDocuments()
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  useEffect(() => { window.addEventListener('youdub:resources-ready', types.refresh); return () => window.removeEventListener('youdub:resources-ready', types.refresh) }, [types.refresh])
  const [selected, setSelected] = useState('')
  const [selectedGraph, setSelectedGraph] = useState('')
  const [draft, setDraft] = useState<WorkflowRunDraft>({ selectedFiles: [], sourceUrl: '', runtimeByDocument: {} })
  const [overrides, setOverrides] = useState<Record<string, Record<string, JsonObject>>>({})
  const [locked, setLocked] = useState(false)
  const lockChanged = useCallback((value: boolean) => { setLocked(value); onLockChange?.(value) }, [onLockChange])
  const record = documents.data?.items.find((item) => item.id === selectedGraph) ?? documents.data?.items[0]
  if ((documents.error || types.error) && (!documents.data || !types.data)) return <div className="space-y-3"><InlineAlert>{documents.error || types.error}</InlineAlert><Button variant="outline" onClick={() => { documents.refresh(); types.refresh() }}>{tx('Retry', '重试', '再試行')}</Button></div>
  if (!documents.data || !types.data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx('Loading workflows…', '加载工作流…', 'ワークフローを読み込み中…')}</p>
  if (!record) return <div className="space-y-3"><p className="text-sm text-muted-foreground">{tx('No workflows available', '暂无工作流', 'ワークフローがありません')}</p><Link href="/workflows/new" className="text-sm text-link">{tx('Create workflow', '新建工作流', 'ワークフローを作成')}</Link></div>
  const external = additionalWorkflows.find((item) => `workflow:${item.id}` === selected)
  const changes = overrides[record.id]
  const document = changes ? { ...record.document, nodes: record.document.nodes.map((node) => changes[node.id] ? { ...node, config: { ...node.config, ...changes[node.id] } } : node) } : record.document
  const selector = <Select value={external ? `workflow:${external.id}` : `graph:${record.id}`} onValueChange={(value) => { if (typeof value === 'string' && !locked) { setSelected(value); if (value.startsWith('graph:')) setSelectedGraph(value.slice(6)) } }}>
    <SelectTrigger aria-label={tx('Workflow', '工作流', 'ワークフロー')} disabled={locked} className={optionPillClassName}><span className="text-subtle-foreground">{tx('Workflow', '工作流', 'ワークフロー')}</span><span className="min-w-0 truncate font-medium">{external ? text(external.label, language) : record.document.title}</span></SelectTrigger>
    <SelectContent>{documents.data.items.map((item) => <SelectItem key={item.id} value={`graph:${item.id}`}>{item.document.title}</SelectItem>)}{additionalWorkflows.map((item) => <SelectItem key={item.id} value={`workflow:${item.id}`}>{text(item.label, language)}</SelectItem>)}</SelectContent>
  </Select>
  return <section className="space-y-4">
    {(documents.error || types.error) && <InlineAlert>{documents.error || types.error}</InlineAlert>}
    {external && renderWorkflow ? renderWorkflow(external, selector, lockChanged) : <WorkflowRun prominent draft={draft} onDraftChange={setDraft} useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useSlot={useSlot} document={document} types={types.data.items} revision={changes ? null : record.revision} onLockChange={lockChanged} onStarted={() => lockChanged(false)} afterInputs={<div className="flex flex-wrap items-center gap-2">{selector}<WorkflowOptions document={document} types={types.data.items} disabled={locked} useSlot={useSlot} onChange={(nodeId, config) => setOverrides((current) => ({ ...current, [record.id]: { ...current[record.id], [nodeId]: config } }))} /></div>} />}
  </section>
}
export const name = 'client-workflows'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('workflow.node.editors', { id: 'youdub.synthesize', component: bindComponent(ctx, ['useSlot'], SynthesizeNodeEditor) }))
  ctx.effect(() => ctx.slots.register('workflow.node.details', { id: 'youdub.transcript', component: TranscriptNodeDetails }))
  ctx.effect(() => ctx.slots.register('workflow.node.details', { id: 'youdub.translation', component: TranslationNodeDetails }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflows', path: '/workflows', component: bindComponent(ctx, ['request', 'navigate', 'useWorkflowDocuments'], WorkflowLibrary), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflow-editor', path: '/workflows/:id', component: bindComponent(ctx, ['request', 'navigate', 'replace', 'blockNavigation', 'useQuery', 'useSlot', 'useWorkflowResources'], WorkflowRoute), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflow-node', path: '/workflows/:id/nodes/:nodeId', component: bindComponent(ctx, ['request', 'navigate', 'replace', 'blockNavigation', 'useQuery', 'useSlot', 'useWorkflowResources'], WorkflowRoute), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'task-node', path: '/tasks/:id/nodes/:nodeId', component: bindComponent(ctx, ['request', 'navigate', 'blockNavigation', 'useQuery', 'useSlot'], TaskNodePage), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'workflows', routeId: 'workflows', label: { default: 'Workflows', translations: { zh: '工作流', ja: 'ワークフロー' } }, order: 25, icon: GitBranch }))
  ctx.effect(() => ctx.slots.register('task.detail.panels', { id: 'workflow-graph', order: -10, component: bindComponent(ctx, ['request', 'navigate', 'useQuery'], TaskWorkflowPanel) }))
}
