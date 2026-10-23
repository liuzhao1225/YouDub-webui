import { Tag } from '@/components/ui/tag'
import { Surface } from '@/components/ui/surface'
import { NativeSelect } from '@/components/ui/native-select'
import { bindComponent, type Bindings } from '../sdk'
import { Context } from 'cordis'
import { protectPendingSubmissions, useObservableSource } from '../view-hooks'
import { StudioDraftStore } from '@/runtime/studio-draft'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Copy, Download, GitBranch, Loader2, Pencil, Play, Plus, Redo2, Save, Search, FileInput, FileOutput, Trash2, Undo2, Upload, X } from '@/lib/icons'
import { Link, text, type Diagnostic, type NodeTypeDefinition, type RouteProps, type WorkflowDocument, type WorkflowDocumentRecord, type WorkflowDescription } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import type { Text } from '@/locales'
import { Button } from '@/components/ui/button'
import { Page, PageHeader, pageLayoutStyles, useWindowHeader } from '@/components/page-layout'
import { Input } from '@/components/ui/input'
import { InlineAlert } from '@/components/inline-alert'
import { Disclosure } from '@/components/ui/disclosure'
import { WorkflowCanvas } from './workflow-canvas'
import { GraphPorts, NodeSettings, SynthesizeNodeEditor } from './workflow-settings'
import { INPUTS_ID, OUTPUTS_ID, blankWorkflow, copyWorkflowLabels, parseWorkflow, serializeWorkflowEdits, workflowDrafts, workflowViews, workflowTemplateTitle } from './workflow-utils'
import { useUnsavedChanges } from './workflow-guard'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { WorkflowOptions, optionPillClassName } from './workflow-options'
import { WorkflowRun } from './workflow-run'
import { WorkflowRerun } from './workflow-rerun'
import { WorkflowDiagnostics } from './workflow-errors'
import { TaskNodePage, TaskWorkflowPanel, TranscriptNodeDetails, TranslationNodeDetails } from './workflow-task'

function workflowTitle(record: WorkflowDocumentRecord, tx: Text) {
  return record.origin === 'builtin' ? workflowTemplateTitle(record.document, tx) : record.document.title
}

export function WorkflowLibrary({ request, navigate, useWorkflowDocuments }: Bindings<'request' | 'navigate' | 'useWorkflowDocuments'>) {
  const tx = useText()
  const { data, error, refresh } = useWorkflowDocuments()
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState('')
  const invalidFile = failure === 'Unsupported workflow file. Expected youdub.workflow version 1.'
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
    <PageHeader title={tx("workflows.workflows")} actions={<><Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload />{tx("workflows.import")}</Button><Button size="sm" onClick={() => navigate('/workflows/new')}><Plus />{tx("workflows.new.workflow")}</Button><input ref={input} type="file" accept=".json,.workflow.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} /></>} />
    {error && <InlineAlert>{error}</InlineAlert>}
    {failure && <InlineAlert>{invalidFile ? <div className="space-y-1.5"><p>{tx('workflows.invalid.import')}</p><Disclosure contained={false} title={tx('workflow.errors.diagnostics')}>{failure}</Disclosure></div> : failure}</InlineAlert>}
    {data?.legacyDefaultsMigration?.status === 'blocked' && <InlineAlert><p>{tx("workflows.previous.processing.preferences.could.not.be.migrated.the.origina")}</p><ul className="mt-2 list-inside list-disc">{data.legacyDefaultsMigration.diagnostics.map((item, index) => <li key={index}>{item.nodeId ? `${item.nodeId}: ` : ''}{item.message}</li>)}</ul><Button className="mt-3" variant="outline" size="sm" disabled={busy} onClick={() => { setBusy(true); setFailure(''); void request('/api/v2/workflow-documents/migrate-defaults', { method: 'POST' }).then(refresh).catch((failure: Error) => setFailure(failure.message)).finally(() => setBusy(false)) }}>{tx("workflows.retry.migration")}</Button></InlineAlert>}
    {error && <Button variant="outline" onClick={refresh}>{tx("workflows.retry")}</Button>}
    {!data && !error && <Loader2 className="size-5 animate-spin" />}
    {data && !data.items.length && <p className="text-sm text-muted-foreground">{tx("workflows.no.workflows.available")}</p>}
    {(['builtin', 'user', 'plugin'] as const).map((origin) => {
      const items = data?.items.filter((item) => item.origin === origin) ?? []
      if (!items.length) return null
      return <section key={origin} className="space-y-4"><h2 className="font-semibold">{origin === 'builtin' ? tx("workflows.built.in.templates") : origin === 'user' ? tx("workflows.my.workflows") : tx("workflows.plugin.workflows")}</h2><div className="grid gap-3 @min-[30rem]/page:grid-cols-2 @min-[48rem]/page:grid-cols-3">{items.map((item) => <Surface as="article" key={item.id} className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex items-start gap-3"><GitBranch className="size-5 shrink-0 text-status-running-fg" /><div className="min-w-0"><Link href={`/workflows/${item.id}`} className="font-semibold break-words hover:text-link">{workflowTitle(item, tx)}</Link><p className="mt-1 text-xs text-muted-foreground">{tx("workflows.value.nodes", { value1: item.document.nodes.length })}</p></div></div>
        <div className="mt-auto flex flex-wrap gap-2"><Button size="sm" onClick={() => navigate(`/workflows/${encodeURIComponent(item.id)}?run=1`)}><Play />{tx("workflows.use")}</Button><Button size="sm" variant="outline" onClick={() => navigate(`/workflows/${encodeURIComponent(item.id)}`)}><Pencil />{tx("workflows.edit")}</Button>{origin === 'user' && <Button size="sm" variant={deleting === item.id ? 'destructive' : 'ghost'} disabled={busy} onClick={() => {
          if (deleting !== item.id) { setDeleting(item.id); return }
          setBusy(true); setFailure('')
          void request(`/api/v2/workflow-documents/${item.id}?expectedRevision=${item.revision}`, { method: 'DELETE' }).then(refresh).catch((error: Error) => setFailure(error.message)).finally(() => setBusy(false))
        }}><Trash2 />{deleting === item.id ? tx("workflows.confirm.delete") : tx("workflows.delete")}</Button>}{deleting === item.id && <Button size="sm" variant="ghost" onClick={() => setDeleting('')}>{tx("workflows.keep")}</Button>}</div>
      </Surface>)}</div></section>
    })}
  </Page>
}

export function WorkflowRoute({ params, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: RouteProps & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText()
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  useEffect(() => { window.addEventListener('youdub:resources-ready', types.refresh); return () => window.removeEventListener('youdub:resources-ready', types.refresh) }, [types.refresh])
  return <>{types.error && <Page as="div" className={params.nodeId ? undefined : 'max-w-none'}><InlineAlert>{types.error}</InlineAlert>{!types.data && <Button variant="outline" onClick={types.refresh}>{tx("workflows.retry")}</Button>}</Page>}{!types.data ? !types.error && <Page as="div" className={params.nodeId ? undefined : 'max-w-none'}><p role="status">{tx("workflows.loading")}</p></Page> : params.id === 'new' ? <NewEditor query={params.__search} useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} types={types.data.items} nodeId={params.nodeId} /> : <SavedEditor query={params.__search} useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} id={params.id} nodeId={params.nodeId} types={types.data.items} />}</>
}
function NewEditor({ query, types, nodeId, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: { query?:string; types: NodeTypeDefinition[]; nodeId?: string } & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText()
  const [record] = useState(() => {
    const document = blankWorkflow(); document.title = tx("workflows.untitled.workflow")
    return { id: 'new', revision: 0, document, origin: 'user' as const }
  })
  return <Editor query={query} useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} initial={record} types={types} nodeId={nodeId} />
}
function SavedEditor({ query, id, nodeId, types, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: { query?:string; id: string; nodeId?: string; types: NodeTypeDefinition[] } & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText()
  const { data, error, refresh } = useQuery<WorkflowDocumentRecord>(`/api/v2/workflow-documents/${encodeURIComponent(id)}`)
  if (error) return <Page className={nodeId ? undefined : 'max-w-none'}><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx("workflows.retry")}</Button></Page>
  if (!data) return <Page className={nodeId ? undefined : 'max-w-none'}><p role="status">{tx("workflows.loading")}</p></Page>
  return <Editor query={query} useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} replace={replace} blockNavigation={blockNavigation} useQuery={useQuery} useSlot={useSlot} key={id} initial={data} nodeId={nodeId} types={types} />
}

function Editor({ query, initial, types, nodeId, request, navigate, replace, blockNavigation, useQuery, useSlot, useWorkflowResources }: { query?:string; initial: WorkflowDocumentRecord; types: NodeTypeDefinition[]; nodeId?: string } & Bindings<'request' | 'navigate' | 'replace' | 'blockNavigation' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText(), { language } = useI18n()
  const windowHeader = useWindowHeader()
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [initialDraft] = useState(() => workflowDrafts.get(initial.id))
  const [initialView] = useState(() => { const view = workflowViews.get(initial.id); return view?.revision === initial.revision ? view : undefined })
  const [sourceTask] = useState(() => new URLSearchParams(query ?? window.location.search).get('sourceTask'))
  const sourceQuery = sourceTask ? `?sourceTask=${encodeURIComponent(sourceTask)}` : ''
  const [document, setDocument] = useState<WorkflowDocument>(() => structuredClone(initialDraft?.document ?? (initialView ? { ...initial.document, presentation: { ...initial.document.presentation, viewport: initialView.viewport } } : initial.document)))
  const [saved, setSaved] = useState(initialDraft?.saved ?? serializeWorkflowEdits(initial.document))
  const [revision, setRevision] = useState(initialDraft?.revision ?? initial.revision)
  const [selected, setSelected] = useState<string | undefined>(nodeId), [panel, setPanel] = useState<'nodes' | 'inputs' | 'outputs' | 'run' | null>(() => new URLSearchParams(query ?? window.location.search).get('run') === '1' ? 'run' : initial.id === 'new' && !initialDraft?.document.nodes.length ? 'nodes' : null)
  const panelId = useId()
  const panelButtons = useRef<Partial<Record<NonNullable<typeof panel>, HTMLButtonElement | null>>>({})
  function closePanel() {
    if (panel) panelButtons.current[panel]?.focus()
    setPanel(null); setSelected(undefined)
  }
  const [freshInputs, setFreshInputs] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [validated, setValidated] = useState(false)
  const [undo, setUndo] = useState<WorkflowDocument[]>(initialDraft?.undo ?? []), [redo, setRedo] = useState<WorkflowDocument[]>(initialDraft?.redo ?? [])
  const [fitOnLoad] = useState(!(initialDraft?.canvasViewed ?? initialView?.canvasViewed))
  const canvasViewed = useRef(initialDraft?.canvasViewed ?? initialView?.canvasViewed ?? false)
  const addAtCenter = useRef<((type: NodeTypeDefinition) => void) | null>(null)
  const [runLocked, setRunLocked] = useState(false)
  const runLock = useRef(false), allowLeave = useRef(false)
  const onRunLockChange = useCallback((locked: boolean) => { runLock.current = locked; setRunLocked(locked) }, [])
  const blockedMessage = tx("workflows.finish.checking.or.clearing.this.submission.before.leaving")
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
  useEffect(() => {
    if (dirty) workflowDrafts.set(initial.id, { document, saved, revision, origin: initial.origin, undo, redo, canvasViewed: canvasViewed.current })
    else workflowDrafts.delete(initial.id)
    workflowViews.set(initial.id, { revision, viewport: document.presentation.viewport, canvasViewed: canvasViewed.current })
  }, [document, saved, revision, initial.id, initial.origin, undo, redo, dirty])
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
      const copied = initial.origin === 'builtin' ? copyWorkflowLabels(current.current, tx) : current.current
      const next = create ? { ...copied, id: crypto.randomUUID(), title: copy || initial.origin !== 'user' ? `${copied.title} · ${tx("workflows.copy")}` : copied.title } : current.current
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
  const openNode = (id: string) => { if (runLock.current) return; if (id === INPUTS_ID || id === OUTPUTS_ID) { setSelected(id); setPanel(id === INPUTS_ID ? 'inputs' : 'outputs'); return } if (serializeWorkflowEdits(current.current) !== saved) workflowDrafts.set(initial.id, { document: current.current, saved, revision, origin: initial.origin, ...history.current, canvasViewed: canvasViewed.current }); workflowViews.set(initial.id, { revision, viewport: current.current.presentation.viewport, canvasViewed: canvasViewed.current }); navigate(`/workflows/${initial.id}/nodes/${id}${sourceQuery}`) }
  const onStarted = () => { allowLeave.current = true; guard.bypass() }
  const active = document.nodes.find((node) => node.id === (nodeId ?? selected))
  const visibleTypes = types.filter((type) => !type.provider.legacy && `${text(type.label, language)} ${type.type} ${type.category}`.toLowerCase().includes(search.toLowerCase()))
  const Layout = nodeId ? Page : 'main'
  return <Layout className={nodeId ? undefined : pageLayoutStyles.workspace}>
    {guard.dialog}
    <div data-window-drag className={windowHeader ? 'contents' : `border-b border-border ${nodeId ? pageLayoutStyles.nodeHeader : pageLayoutStyles.workspaceHeader}`}>
      <PageHeader title={initial.origin === 'builtin' ? workflowTemplateTitle(document, tx) : document.title}
        leading={<Button size="icon-sm" variant="ghost" disabled={editingLocked} aria-label={tx("workflows.back")} onClick={() => navigate(nodeId ? `/workflows/${initial.id}${sourceQuery}` : '/workflows')}><ArrowLeft /></Button>}
        titleControl={renaming ? <Input autoFocus aria-label={tx("workflows.workflow.name")} disabled={editingLocked} className="w-full max-w-xs" value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => { if (nameDraft.trim()) change({ ...document, title: nameDraft.trim() }); setRenaming(false) }}
          onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) } }} /> : undefined}
        badge={<>{!renaming && <Button size="icon-sm" variant="ghost" aria-label={tx("workflows.workflow.name")} title={tx("workflows.workflow.name")} disabled={editingLocked} onClick={() => { setNameDraft(initial.origin === 'builtin' ? workflowTemplateTitle(document, tx) : document.title); setRenaming(true) }}><Pencil /></Button>}<Tag tone="neutral">{dirty ? tx("workflows.unsaved") : initial.origin !== 'user' ? tx("workflows.template") : revision ? tx("workflows.saved") : tx("workflows.draft")}</Tag></>}
        actions={<><Button size="icon-sm" variant="ghost" disabled={editingLocked || !undo.length} aria-label={tx("workflows.undo")} onClick={undoChange}><Undo2 /></Button><Button size="icon-sm" variant="ghost" disabled={editingLocked || !redo.length} aria-label={tx("workflows.redo")} onClick={redoChange}><Redo2 /></Button>
      <Button size="sm" variant="outline" disabled={editingLocked || (initial.origin === 'user' && revision > 0 && !dirty)} onClick={() => void save().catch(() => undefined)}><Save />{initial.origin !== 'user' ? tx("workflows.save.copy") : tx("workflows.save")}</Button>
      {!nodeId && <Button ref={node => { panelButtons.current.run = node }} aria-expanded={panel === 'run'} aria-controls={panel === 'run' ? panelId : undefined} size="sm" disabled={editingLocked || !document.nodes.length} onClick={() => { setSelected(undefined); setPanel('run') }}><Play />{tx("workflows.run")}</Button>}</>} />
    </div>
    {error && <div className="px-4 py-2"><InlineAlert>{error}</InlineAlert></div>}
    {dirty && initial.revision > revision && <div className="px-4 py-2"><InlineAlert>{tx("workflows.this.draft.is.based.on.an.older.workflow.revision.save.a.copy.to.")}</InlineAlert></div>}
    {!!diagnostics.length && <div className="max-h-48 space-y-2 overflow-auto border-b border-border px-4 py-2"><WorkflowDiagnostics diagnostics={diagnostics} document={document} types={types} disabled={editingLocked} onSelect={(item) => { if (item.nodeId) { setSelected(item.nodeId); setPanel(null) } }} /></div>}
    {validated && <p role="status" className="border-b border-border px-4 py-2 text-xs text-status-success-fg">{tx("workflows.workflow.valid")}</p>}
    {nodeId ? active ? <Surface as="section" className=""><NodeSettings useSlot={useSlot} document={document} node={active} types={types} readOnly={editingLocked} onChange={change} onDelete={() => { workflowDrafts.set(initial.id, { document: current.current, saved, revision, origin: initial.origin, ...history.current, canvasViewed: canvasViewed.current }); navigate(`/workflows/${initial.id}${sourceQuery}`) }} /></Surface> : <InlineAlert>{tx("workflows.node.not.found")}</InlineAlert> : <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Button ref={node => { panelButtons.current.nodes = node }} aria-expanded={panel === 'nodes'} aria-controls={panel === 'nodes' ? panelId : undefined} size="sm" disabled={editingLocked} variant={panel === 'nodes' ? 'secondary' : 'ghost'} onClick={() => { setPanel(panel === 'nodes' ? null : 'nodes'); setSelected(undefined) }}><Plus />{tx("workflows.add.node")}</Button>
        <Button ref={node => { panelButtons.current.inputs = node }} aria-expanded={panel === 'inputs'} aria-controls={panel === 'inputs' ? panelId : undefined} size="sm" disabled={editingLocked} variant={panel === 'inputs' ? 'secondary' : 'ghost'} onClick={() => { setPanel(panel === 'inputs' ? null : 'inputs'); setSelected(panel === 'inputs' ? undefined : INPUTS_ID) }}><FileInput />{tx("workflow.canvas.inputs")}</Button>
        <Button ref={node => { panelButtons.current.outputs = node }} aria-expanded={panel === 'outputs'} aria-controls={panel === 'outputs' ? panelId : undefined} size="sm" disabled={editingLocked} variant={panel === 'outputs' ? 'secondary' : 'ghost'} onClick={() => { setPanel(panel === 'outputs' ? null : 'outputs'); setSelected(panel === 'outputs' ? undefined : OUTPUTS_ID) }}><FileOutput />{tx("workflow.canvas.outputs")}</Button>
        <Button size="sm" variant="ghost" disabled={editingLocked} onClick={() => void validate()}>{tx("workflows.validate")}</Button>
        <div className="ml-auto flex gap-1">{initial.origin === 'user' && revision > 0 && <Button size="icon-sm" variant="ghost" aria-label={tx("workflows.save.as")} disabled={editingLocked} onClick={() => void save(true).catch(() => undefined)}><Copy /></Button>}<Button size="icon-sm" variant="ghost" disabled={editingLocked} aria-label={tx("workflows.export.workflow")} onClick={exportFile}><Download /></Button></div>
      </div>
      <div className="workflow-editor-layout flex-1">
        <WorkflowCanvas document={document} types={types} selected={selected} disabled={editingLocked} fitOnLoad={fitOnLoad} addNodeRef={addAtCenter} onReady={() => { canvasViewed.current = true; const draft = workflowDrafts.get(initial.id); if (draft) draft.canvasViewed = true; workflowViews.set(initial.id, { revision, viewport: current.current.presentation.viewport, canvasViewed: true }) }} onSelect={(id) => { if (!runLock.current) { setSelected(id); setPanel(id === INPUTS_ID ? 'inputs' : id === OUTPUTS_ID ? 'outputs' : null) } }} onChange={change} onCheckpoint={() => { if (!runLock.current) { const nextUndo = [...history.current.undo.slice(-99), current.current]; history.current = { undo: nextUndo, redo: [] }; setUndo(nextUndo); setRedo([]) } }} onOpen={openNode} />
        {(panel || active) && <aside id={panelId} className="workflow-inspector" onKeyDown={event => { if (panel && event.key === 'Escape' && !event.defaultPrevented && !editingLocked) { event.preventDefault(); event.stopPropagation(); closePanel() } }}>
          {active && !panel ? <NodeSettings useSlot={useSlot} document={document} node={active} types={types} readOnly={editingLocked} onChange={change} onClose={() => setSelected(undefined)} onOpen={() => openNode(active.id)} /> : <>
            <div className="flex items-center justify-between border-b border-border p-4"><h2 className="font-semibold">{panel === 'nodes' ? tx("workflows.nodes") : panel === 'run' ? tx("workflows.run.workflow") : panel === 'inputs' ? tx("workflow.canvas.inputs") : tx("workflow.canvas.outputs")}</h2><Button size="icon-sm" variant="ghost" disabled={editingLocked} aria-label={tx("workflows.close.panel")} onClick={closePanel}><X /></Button></div>
            {panel === 'nodes' && <div className="flex flex-col gap-3 p-4"><div className="relative"><Input icon={<Search className="size-4" />} aria-label={tx("workflows.search.nodes")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>{!visibleTypes.length && <p className="text-sm text-muted-foreground">{tx("workflows.no.nodes.found")}</p>}{visibleTypes.map((type) => <Button variant="outline" type="button" draggable key={`${type.providerId}:${type.type}`} onDragStart={(event) => event.dataTransfer.setData('application/youdub-node', `${type.providerId}:${type.type}`)} className="flex h-auto w-full items-center justify-start gap-3 py-3 text-left whitespace-normal" disabled={editingLocked} onClick={() => { if (addAtCenter.current) addAtCenter.current(type); else setError(tx("workflows.the.canvas.is.still.loading")) }}><Plus className="size-4 shrink-0 text-link" /><span className="min-w-0"><span className="block text-sm font-medium">{text(type.label, language)}</span><span className="block truncate text-xs text-muted-foreground">{text(type.provider.label, language) || type.providerId}</span></span></Button>)}</div>}
            {(panel === 'inputs' || panel === 'outputs') && <GraphPorts direction={panel} disabled={editingLocked} document={document} types={types} onChange={change} />}
            {panel === 'run' && <div className="space-y-4 p-4">{sourceTask && <label className="grid gap-2 text-sm">{tx("workflows.media.source")}<NativeSelect disabled={editingLocked}  value={freshInputs ? 'new' : 'existing'} onChange={(event) => setFreshInputs(event.target.value === 'new')}><option value="existing">{tx("workflows.reuse.original.media")}</option><option value="new">{tx("workflows.choose.new.media")}</option></NativeSelect></label>}{sourceTask && !freshInputs ? <WorkflowRerun useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useQuery={useQuery} useSlot={useSlot} taskId={sourceTask} document={document} types={types} onStarted={onStarted} onLockChange={onRunLockChange} /> : <WorkflowRun useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useSlot={useSlot} document={document} types={types} revision={dirty ? null : revision} onStarted={onStarted} onLockChange={onRunLockChange} />}</div>}
          </>}
        </aside>}
      </div>
    </>}
  </Layout>
}

export function GraphStudio({ draftStore, onLockChange, additionalWorkflows = [], renderWorkflow, request, navigate, useQuery, useSlot, useWorkflowDocuments, useWorkflowResources }: { draftStore?: StudioDraftStore; onLockChange?(locked: boolean): void; additionalWorkflows?: WorkflowDescription[]; renderWorkflow?(workflow: WorkflowDescription, selector: ReactNode, onLockChange: (locked: boolean) => void): ReactNode } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot' | 'useWorkflowDocuments' | 'useWorkflowResources'>) {
  const tx = useText(), { language } = useI18n()
  const documents = useWorkflowDocuments()
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  useEffect(() => { window.addEventListener('youdub:resources-ready', types.refresh); return () => window.removeEventListener('youdub:resources-ready', types.refresh) }, [types.refresh])
  const [localStore] = useState(() => new StudioDraftStore())
  const store = draftStore ?? localStore
  const { selected, selectedGraph, draft, overrides } = useObservableSource(store)
  const setSelected = (value: string) => store.set('selected', value)
  const setSelectedGraph = (value: string) => store.set('selectedGraph', value)
  const [locked, setLocked] = useState(false)
  const lockChanged = useCallback((value: boolean) => { setLocked(value); onLockChange?.(value) }, [onLockChange])
  const record = documents.data?.items.find((item) => item.id === selectedGraph) ?? documents.data?.items[0]
  if ((documents.error || types.error) && (!documents.data || !types.data)) return <div className="space-y-3"><InlineAlert>{documents.error || types.error}</InlineAlert><Button variant="outline" onClick={() => { documents.refresh(); types.refresh() }}>{tx("workflows.retry")}</Button></div>
  if (!documents.data || !types.data) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx("workflows.loading.workflows")}</p>
  if (!record) return <div className="space-y-3"><p className="text-sm text-muted-foreground">{tx("workflows.no.workflows.available")}</p><Link href="/workflows/new" className="text-sm text-link">{tx("workflows.create.workflow")}</Link></div>
  const external = additionalWorkflows.find((item) => `workflow:${item.id}` === selected)
  const changes = overrides[record.id]
  const document = changes ? { ...record.document, nodes: record.document.nodes.map((node) => changes[node.id] ? { ...node, config: { ...node.config, ...changes[node.id] } } : node) } : record.document
  const selector = <Select value={external ? `workflow:${external.id}` : `graph:${record.id}`} onValueChange={(value) => { if (typeof value === 'string' && !locked) { setSelected(value); if (value.startsWith('graph:')) setSelectedGraph(value.slice(6)) } }}>
    <SelectTrigger aria-label={tx("workflows.workflow")} disabled={locked} className={optionPillClassName}><span className="text-subtle-foreground">{tx("workflows.workflow")}</span><span className="min-w-0 truncate font-medium">{external ? text(external.label, language) : workflowTitle(record, tx)}</span></SelectTrigger>
    <SelectContent>{documents.data.items.map((item) => <SelectItem key={item.id} value={`graph:${item.id}`}>{workflowTitle(item, tx)}</SelectItem>)}{additionalWorkflows.map((item) => <SelectItem key={item.id} value={`workflow:${item.id}`}>{text(item.label, language)}</SelectItem>)}</SelectContent>
  </Select>
  return <section className="space-y-4">
    {(documents.error || types.error) && <InlineAlert>{documents.error || types.error}</InlineAlert>}
    {external && renderWorkflow ? renderWorkflow(external, selector, lockChanged) : <WorkflowRun prominent submissionStore={store} draft={draft} onDraftChange={value => store.set('draft', value)} useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useSlot={useSlot} document={document} types={types.data.items} revision={changes ? null : record.revision} onLockChange={lockChanged} onStarted={() => { store.clearGraph(record.id); lockChanged(false) }} afterInputs={<div className="flex flex-wrap items-center gap-2">{selector}<WorkflowOptions document={document} types={types.data.items} disabled={locked} useSlot={useSlot} onChange={(nodeId, config) => store.set('overrides', (current) => ({ ...current, [record.id]: { ...current[record.id], [nodeId]: config } }))} /></div>} />}
  </section>
}
export const name = 'client-workflows'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  const submissionStore = new StudioDraftStore()
  ctx.effect(() => () => submissionStore.reset())
  protectPendingSubmissions(ctx, submissionStore)
  const BoundTaskNode = bindComponent(ctx, ['request', 'navigate', 'blockNavigation', 'useQuery', 'useSlot'], TaskNodePage)
  ctx.effect(() => ctx.slots.register('workflow.node.editors', { id: 'youdub.synthesize', component: bindComponent(ctx, ['useSlot'], SynthesizeNodeEditor) }))
  ctx.effect(() => ctx.slots.register('workflow.node.details', { id: 'youdub.transcript', component: TranscriptNodeDetails }))
  ctx.effect(() => ctx.slots.register('workflow.node.details', { id: 'youdub.translation', component: TranslationNodeDetails }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflows', path: '/workflows', component: bindComponent(ctx, ['request', 'navigate', 'useWorkflowDocuments'], WorkflowLibrary), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflow-editor', path: '/workflows/:id', component: bindComponent(ctx, ['request', 'navigate', 'replace', 'blockNavigation', 'useQuery', 'useSlot', 'useWorkflowResources'], WorkflowRoute), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'workflow-node', path: '/workflows/:id/nodes/:nodeId', component: bindComponent(ctx, ['request', 'navigate', 'replace', 'blockNavigation', 'useQuery', 'useSlot', 'useWorkflowResources'], WorkflowRoute), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'task-node', path: '/tasks/:id/nodes/:nodeId', component: props => <BoundTaskNode {...props} submissionStore={submissionStore} />, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'workflows', routeId: 'workflows', label: { default: 'Workflows', translations: { zh: '工作流', ja: 'ワークフロー' } }, order: 25, icon: GitBranch }))
  ctx.effect(() => ctx.slots.register('task.detail.panels', { id: 'workflow-graph', order: -10, component: bindComponent(ctx, ['request', 'navigate', 'useQuery'], TaskWorkflowPanel) }))
}
