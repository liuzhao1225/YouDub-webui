import { assetUrl } from '@/lib/asset-url'
import { copyText } from '@/lib/clipboard'
import { NativeSelect } from '@/components/ui/native-select'
import type { Bindings } from '../sdk'
import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { ArrowLeft, Check, Copy, Download, GitBranch, Loader2, RotateCw, Save, Search } from 'lucide-react'
import { Link, text, type GraphNode, type JsonObject, type JsonSchema, type NodeDetailProps, type NodeTypeDefinition, type PanelProps, type RouteProps, type TaskNodeDetail, type TaskView, type WorkflowDocumentRecord } from '../sdk'
import { StudioDraftStore } from '@/runtime/studio-draft'
import { useActiveView, useObservableSource, usePendingUnload } from '../view-hooks'
import { taskNeedsPolling } from '../runtime/query'
import { useI18n, useText } from '@/lib/i18n'
import { useReleaseMediaOnUnmount } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Page, PageHeader } from '@/components/page-layout'
import { Input } from '@/components/ui/input'
import { InlineAlert } from '@/components/inline-alert'
import { WorkflowCanvas } from './workflow-canvas'
import { TaskState } from './task-status'
import { NodePluginBoundary } from './workflow-settings'
import { nodeDefinition } from './workflow-utils'
import { useUnsavedChanges } from './workflow-guard'

type Transcript = { detected_language: string; segments: { id: string | number; start_ms: number; end_ms: number; text: string; words?: unknown; speaker_id?: string }[] }
type Translation = { source_language: string; target_language: string; segments: { segment_id: string | number; text: string }[] }
type SpeechAudio = { segments: { id: string; audio: { id: string; schemaId: string }; sampleRate: number; channels: number; sampleCount: number }[] }
type RerunPreview = { reusedSteps: string[]; dirtySteps: string[]; expectedAttempt: number; expectedTaskRevision: number; sourceRevisions: Record<string, number> }
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as JsonObject, b = right as JsonObject
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
}
function correctionPatch(next: JsonObject, original: JsonObject): JsonObject {
  const normalized = { ...next }
  const transcript = next.transcript as Transcript | undefined, previous = original.transcript as Transcript | undefined
  if (transcript?.segments && previous?.segments) normalized.transcript = { ...transcript, segments: transcript.segments.map((segment) => {
    const source = previous.segments.find((item) => item.id === segment.id)
    if (!source) return segment
    const content = { ...segment }, sourceContent = { ...source }
    delete content.words; delete sourceContent.words
    // Reverting a text/timing edit also restores its original word timestamps.
    return sameValue(content, sourceContent) ? source : segment
  }) }
  return Object.fromEntries(Object.entries(normalized).filter(([port, value]) => !sameValue(value, original[port])))
}
function SegmentTextArea({ value, ...props }: ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = ref.current!
    const resize = () => {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`
    }
    resize()
    let width = element.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width
      if (nextWidth !== width) { width = nextWidth; resize() }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [value])
  return <textarea {...props} ref={ref} rows={1} value={value} className="min-h-9 w-full min-w-0 resize-y rounded-lg border border-input bg-input-bg px-2 py-1.5 text-sm leading-5 text-foreground focus-visible:outline-ring" />
}

export function TaskWorkflowPanel({ task, request, navigate, useQuery }: PanelProps & Bindings<'request' | 'navigate' | 'useQuery'>) {
  if (!task.graphSnapshot) return null
  return <TaskGraph request={request} navigate={navigate} useQuery={useQuery} task={task} />
}
function TaskGraph({ task, request, navigate, useQuery }: { task: TaskView } & Bindings<'request' | 'navigate' | 'useQuery'>) {
  const tx = useText()
  const { data, error, refresh } = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">{tx("workflow.task.workflow")}</h2><div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => {
        setBusy(true); setFailure('')
        const document = { ...task.graphSnapshot!, id: crypto.randomUUID(), title: `${task.graphSnapshot!.title} · ${tx("workflow.task.copy")}` }
        void request<WorkflowDocumentRecord>('/api/v2/workflow-documents', { method: 'POST', body: JSON.stringify({ document }) }).then((record) => navigate(`/workflows/${record.id}?sourceTask=${task.id}`)).catch((failure: Error) => setFailure(failure.message)).finally(() => setBusy(false))
      }}><Copy />{tx("workflow.task.edit.workflow.copy")}</Button>
    </div></header>
    {(error || failure) && <div className="space-y-2 p-4"><InlineAlert>{error || failure}</InlineAlert>{error && <Button variant="outline" size="sm" onClick={refresh}><RotateCw />{tx("workflow.task.reload")}</Button>}</div>}
    <div className="h-[min(60dvh,36rem)] min-h-80">{data && <WorkflowCanvas document={task.graphSnapshot!} types={data.items} steps={task.steps} readOnly onOpen={(id) => navigate(`/tasks/${task.id}/nodes/${id}`)} />}</div>
  </section>
}

export function TaskNodePage({ submissionStore, params, request, navigate, blockNavigation, useQuery, useSlot }: RouteProps & { submissionStore?: StudioDraftStore } & Bindings<'request' | 'navigate' | 'blockNavigation' | 'useQuery' | 'useSlot'>) {
  const tx = useText()
  const [localStore] = useState(() => new StudioDraftStore())
  const store = submissionStore ?? localStore
  const task = useQuery<TaskView>(`/api/v2/tasks/${encodeURIComponent(params.id)}`, 2000, taskNeedsPolling)
  const detail = useQuery<TaskNodeDetail>(`/api/v2/tasks/${encodeURIComponent(params.id)}/nodes/${encodeURIComponent(params.nodeId)}`, 2000, taskNeedsPolling)
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  const failure = task.error || detail.error || types.error
  const refresh = () => { task.refresh(); detail.refresh(); types.refresh() }
  if (!task.data || !detail.data || !types.data) return <Page>{failure ? <><InlineAlert>{failure}</InlineAlert><Button variant="outline" onClick={refresh}><RotateCw />{tx("workflow.task.reload")}</Button></> : <p role="status">{tx("workflow.task.loading")}</p>}</Page>
  return <NodeDetail submissionStore={store} useQuery={useQuery} request={request} navigate={navigate} blockNavigation={blockNavigation} useSlot={useSlot} task={task.data} detail={detail.data} types={types.data.items} error={failure} refresh={refresh} />
}
function NodeDetail({ submissionStore, task, detail, types, error, refresh, request, navigate, blockNavigation, useSlot, useQuery }: { submissionStore: StudioDraftStore; task: TaskView; detail: TaskNodeDetail; types: NodeTypeDefinition[]; error: string; refresh(): void } & Bindings<'request' | 'navigate' | 'blockNavigation' | 'useSlot' | 'useQuery'>) {
  const tx = useText(), { language } = useI18n()
  const node = task.graphSnapshot?.nodes.find((item) => item.id === detail.nodeId)
  const definition = node && nodeDefinition(node, types)
  const details = useSlot('workflow.node.details')
  const Custom = details.find((entry) => entry.id === definition?.ui?.detailId)?.component
  const [patch, setPatch] = useState<JsonObject>({})
  const [tab, setTab] = useState<'result' | 'inputs' | 'config' | 'log'>('result')
  const [viewRevision, setViewRevision] = useState<number | null>(null)
  const [localFailure, setFailure] = useState(''), [operationBusy, setBusy] = useState(false), [pending, setPending] = useState('')
  const [preview, setPreview] = useState<RerunPreview | null>(null)
  const { submissions } = useObservableSource(submissionStore)
  const submissionKey = `derived:${task.id}:${detail.nodeId}`, submission = submissions[submissionKey]
  const newTaskId = submission?.id ?? '', busy = operationBusy || !!submission?.busy, failure = submission?.error || localFailure
  const activeView = useActiveView()
  usePendingUnload(!!newTaskId || !!pending)
  const revision = viewRevision ?? detail.outputRevision
  const result = detail.resultRevisions.find((item) => item.revision === revision)
  const outputs = result?.outputs ?? detail.step.outputs ?? {}
  const dirty = Object.keys(patch).length > 0
  const awaitingReview = ['queued', 'running', 'waiting', 'paused'].includes(detail.status) && detail.step.status === 'awaiting_review'
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(detail.status)
  const historical = revision !== detail.outputRevision
  const canReview = awaitingReview && !historical
  const canDerive = ['succeeded', 'failed', 'cancelled'].includes(detail.status) && !!result && revision === detail.outputRevision
  const editable = (canReview || canDerive) && !!definition?.corrections && !busy && !pending && !newTaskId
  const baseline = useRef({ revision, taskRevision: detail.taskRevision, outputs })
  const displayed = { ...(dirty ? baseline.current.outputs : outputs), ...patch }
  const transcript = (historical ? undefined : detail.inputs.transcript ?? displayed.transcript) as Transcript | undefined
  const displayedDetail = historical ? { ...detail, inputs: Object.fromEntries(Object.entries(detail.inputs).filter(([name]) => name !== 'transcript')) } : detail
  const changesDownstream = dirty && task.graphSnapshot?.edges.some((edge) => edge.source.nodeId === detail.nodeId)
  const finishesTask = canReview && !changesDownstream && task.revision === detail.taskRevision && task.steps.every((step) => step.id === detail.nodeId || step.status === 'completed')
  const nodeName = (id: string) => {
    const selected = task.graphSnapshot?.nodes.find((item) => item.id === id)
    return selected?.label || text(task.steps.find((step) => step.id === id)?.label, language) || text(selected && nodeDefinition(selected, types)?.label, language) || tx("workflow.task.node")
  }
  function changeDraft(next: JsonObject) {
    if (!dirty) baseline.current = { revision, taskRevision: detail.taskRevision, outputs }
    setPatch(correctionPatch(next, baseline.current.outputs)); setPreview(null)
  }
  function discardDraft() {
    setPatch({}); setViewRevision(null); setPreview(null); setFailure('')
    baseline.current = { revision: detail.outputRevision, taskRevision: detail.taskRevision, outputs: detail.step.outputs ?? {} }
    refresh()
  }
  const guard = useUnsavedChanges(blockNavigation, dirty, canReview ? () => submit(false) : undefined)
  async function submit(continueAfter: boolean) {
    if (!canReview || pending) throw new Error(tx("workflow.task.this.result.cannot.be.approved.now"))
    setBusy(true); setFailure('')
    const actionId = crypto.randomUUID()
    const body = { actionId, expectedAttempt: detail.attempt, expectedTaskRevision: dirty ? baseline.current.taskRevision : detail.taskRevision, expectedOutputRevision: dirty ? baseline.current.revision : detail.outputRevision, ...(dirty ? { patch, continue: continueAfter } : {}) }
    try {
      setPending(actionId)
      await request(`/api/v2/tasks/${task.id}/nodes/${detail.nodeId}/${dirty ? 'corrections' : 'approve'}`, { method: 'POST', body: JSON.stringify(body) })
      setPending(''); setPatch({}); setViewRevision(null); refresh()
      if (continueAfter && activeView.current) { guard.bypass(); navigate(`/tasks/${task.id}`) }
    } catch (error) {
      if ((error as { status?: number }).status && (error as { status: number }).status < 500) setPending('')
      setFailure(error instanceof Error ? error.message : String(error)); throw error
    } finally { setBusy(false) }
  }
  async function rerunPreview() {
    setBusy(true); setFailure('')
    try {
      const payload = { config: {}, graphDocument: task.graphSnapshot, expectedAttempt: detail.attempt, expectedTaskRevision: detail.taskRevision, corrections: { [detail.nodeId]: { revision, patch } } }
      setPreview(await request<RerunPreview>(`/api/v2/tasks/${task.id}/rerun-preview`, { method: 'POST', body: JSON.stringify(payload) }))
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  function openDerived(next: TaskView) {
    if (!activeView.current) return
    submissionStore.clearSubmission(submissionKey); setPatch({}); guard.bypass(); navigate(`/tasks/${next.id}`)
  }
  async function createDerived() {
    if (!preview || busy || newTaskId) return
    setFailure('')
    const next = await submissionStore.submit(submissionKey, request, JSON.stringify({ ...preview, id: crypto.randomUUID(), config: {}, graphDocument: task.graphSnapshot, corrections: { [detail.nodeId]: { revision, patch } } }), `/api/v2/tasks/${task.id}/rerun`)
    if (next) openDerived(next)
  }
  const generic = detail.spec.operation === 'speech.synthesize/v1' && displayed.speechAudio
    ? <SpeechResult taskId={task.id} value={displayed.speechAudio as SpeechAudio} translation={historical ? undefined : detail.inputs.translation as Translation | undefined} historical={historical} raw={displayed} />
    : <ResultViewer taskId={task.id} value={displayed} />
  const hasEditor = !!Custom || (!definition?.ui?.detailId && (
    (definition?.corrections?.outputPorts.includes('transcript') && !!displayed.transcript)
    || (definition?.corrections?.outputPorts.includes('translation') && !!displayed.translation)
  ))
  return <Page>
    {guard.dialog}
    <Link href={`/tasks/${task.id}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />{tx("workflow.task.back.to.task")}</Link>
    <PageHeader title={node?.label || text(definition?.label, language) || text(detail.step.label, language)} actions={<TaskState status={detail.step.status} />} />
    {(error || failure) && <div className="space-y-2"><InlineAlert>{error || failure}</InlineAlert>{error && <Button variant="outline" size="sm" onClick={refresh}><RotateCw />{tx("workflow.task.reload")}</Button>}</div>}
    {detail.step.error && <InlineAlert>{detail.step.error.message}</InlineAlert>}
    {['running', 'waiting'].includes(detail.step.status) && <div className="space-y-2 text-sm text-muted-foreground" role="status">{detail.step.message && <p>{detail.step.message}</p>}{detail.step.status === 'running' && detail.step.progress != null && <progress aria-label={tx("workflow.task.node.progress")} value={detail.step.progress} max={1} className="block h-1.5 w-full accent-primary" />}</div>}
    {pending && !busy && <div className="space-y-2"><InlineAlert tone="warning">{tx("workflow.task.submission.needs.verification")}</InlineAlert><Button variant="outline" disabled={busy} onClick={() => {
      setBusy(true); void request(`/api/v2/tasks/${task.id}/actions/${pending}`).then(() => { setPending(''); setPatch({}); setFailure(''); refresh() }).catch((error: Error & { status?: number }) => { setFailure(error.message); if (error.status === 404) setPending('') }).finally(() => setBusy(false))
    }}>{tx("workflow.task.check.submission")}</Button></div>}
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">{(['result', 'inputs', 'config', 'log'] as const).map((value) => <Button key={value} variant={tab === value ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab(value)}>{value === 'result' ? tx("workflow.task.results") : value === 'inputs' ? tx("workflow.task.inputs") : value === 'config' ? tx("workflow.task.configuration") : tx("workflow.task.task.log")}</Button>)}
      {!!detail.resultRevisions.length && <label className="ml-auto flex items-center gap-2 text-xs">{tx("workflow.task.version")}<NativeSelect className="h-8 rounded-lg border border-input bg-input-bg px-2" disabled={dirty || busy || !!pending} value={revision} onChange={(event) => setViewRevision(Number(event.target.value))}>{detail.resultRevisions.map((item) => <option key={item.revision} value={item.revision}>{item.revision} · {item.source === 'computed' ? tx("workflow.task.original") : tx("workflow.task.correction")}{detail.approvedRevision === item.revision ? ` · ${tx("workflow.task.approved")}` : ''}</option>)}</NativeSelect></label>}
    </div>
    {tab === 'result' && historical && !!definition?.corrections && (awaitingReview || terminal) && <Button variant="outline" size="sm" disabled={busy || !!pending || !!newTaskId} onClick={() => {
      const current = detail.resultRevisions.find((item) => item.revision === detail.outputRevision)?.outputs ?? detail.step.outputs ?? {}
      baseline.current = { revision: detail.outputRevision, taskRevision: detail.taskRevision, outputs: current }
      setPatch(correctionPatch(Object.fromEntries(definition.corrections!.outputPorts.filter((port) => port in outputs).map((port) => [port, structuredClone(outputs[port])])), current))
      setViewRevision(null); setPreview(null)
    }}>{tx("workflow.task.restore.this.version.as.a.correction")}</Button>}
    {dirty && <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{tx("workflow.task.unsaved.correction")}</span><Button variant="ghost" size="sm" disabled={busy || !!pending || !!newTaskId} onClick={discardDraft}>{tx("workflow.task.discard.correction.and.reload")}</Button></div>}
    {tab === 'result' && <section className="space-y-5">
      {!Object.keys(outputs).length && <p className="text-sm text-muted-foreground">{tx("workflow.task.no.result.yet")}</p>}
      {Custom ? <NodePluginBoundary key={definition!.ui!.detailId} fallback={generic}><Custom detail={displayedDetail} outputs={dirty ? baseline.current.outputs : outputs} draft={patch} readOnly={!editable} onDraftChange={changeDraft} /></NodePluginBoundary> : definition?.ui?.detailId ? <><InlineAlert>{tx("workflow.task.the.node.detail.plugin.is.unavailable")}</InlineAlert>{generic}</> : definition?.corrections?.outputPorts.includes('transcript') && displayed.transcript ? <TranscriptEditor value={displayed.transcript as Transcript} readOnly={!editable} onChange={(value) => changeDraft({ ...patch, transcript: value })} /> : definition?.corrections?.outputPorts.includes('translation') && displayed.translation ? <TranslationEditor value={displayed.translation as Translation} transcript={transcript} readOnly={!editable} onChange={(value) => changeDraft({ ...patch, translation: value })} /> : generic}
      {hasEditor && Object.entries(displayed).filter(([name]) => name !== 'transcript' && name !== 'translation').map(([name, value]) => <details key={name} className="rounded-lg border border-border bg-card p-2"><summary className="cursor-pointer text-sm font-medium">{text(definition?.outputs.find((port) => port.name === name)?.label, language) || (name === 'raw' ? tx("workflow.task.original.response") : name)}</summary><div className="mt-2"><ResultViewer taskId={task.id} value={value} /></div></details>)}
    </section>}
    {tab === 'inputs' && <ResultViewer taskId={task.id} value={detail.inputs} />}
    {tab === 'config' && <NodeConfiguration node={node} definition={definition} raw={node ?? detail.spec} />}
    {tab === 'log' && <NodeLog useQuery={useQuery} active={taskNeedsPolling(task)} taskId={task.id} />}
    {canReview && <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-card p-4 shadow-card lg:bottom-4">
      <Button variant="outline" disabled={!dirty || busy || !!pending} onClick={() => void submit(false).catch(() => undefined)}><Save />{tx("workflow.task.save.correction")}</Button>
      <Button disabled={busy || !!pending} onClick={() => void submit(true).catch(() => undefined)}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{finishesTask ? dirty ? tx("workflow.task.save.and.complete") : tx("workflow.task.approve.and.complete") : dirty ? tx("workflow.task.save.and.continue") : tx("workflow.task.approve.and.continue")}</Button>
    </div>}
    {((canDerive && dirty) || newTaskId) && <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">{tx("workflow.task.generate.again.with.corrections")}</h2>
      {!preview && <Button disabled={busy || !!newTaskId} variant="outline" onClick={() => void rerunPreview()}><GitBranch />{tx("workflow.task.review.affected.steps")}</Button>}
      {preview && <><p className="text-sm">{tx("workflow.task.keep.existing.results")}: {preview.reusedSteps.map(nodeName).join('、') || '—'}</p><p className="text-sm">{tx("workflow.task.process.again")}: {preview.dirtySteps.map(nodeName).join('、') || '—'}</p><Button disabled={busy || !!newTaskId} onClick={() => void createDerived()}>{tx("workflow.task.create.task.and.generate")}</Button></>}
      {newTaskId && !busy && <Button variant="outline" onClick={() => { void submissionStore.check(submissionKey, request).then(next => { if (next) openDerived(next) }) }}>{tx("workflow.task.check.task.status")}</Button>}
      {newTaskId && !busy && <Button variant="outline" onClick={() => { void submissionStore.discard(submissionKey, request).then(cleared => { if (cleared && activeView.current) { setPreview(null); setFailure('') } }) }}>{tx("workflow.task.return.to.editing")}</Button>}
    </section>}
  </Page>
}
function NodeConfiguration({ node, definition, raw }: { node?: GraphNode; definition?: NodeTypeDefinition; raw: unknown }) {
  const tx = useText(), { language } = useI18n()
  return <section className="space-y-4">
    {node && <dl className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.provider")}</dt><dd className="mt-1 text-sm">{text(definition?.provider.label, language) || node.provider.id}</dd></div>
      {node.provider.model && <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.model")}</dt><dd className="mt-1 break-words text-sm">{node.provider.model}</dd></div>}
      {node.provider.device && <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.device")}</dt><dd className="mt-1 text-sm">{node.provider.device.toUpperCase()}</dd></div>}
      <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.after.completion")}</dt><dd className="mt-1 text-sm">{node.autoContinue ? tx("workflow.task.continue.automatically") : tx("workflow.task.wait.for.approval")}</dd></div>
    </dl>}
    {node && Object.keys(node.config).length > 0 && <ConfigurationValues value={node.config} schema={definition?.configSchema} />}
    <details className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm text-muted-foreground">{tx("workflow.task.raw.configuration")}</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(raw, null, 2)}</pre></details>
  </section>
}
function ConfigurationValues({ value, schema }: { value: JsonObject; schema?: JsonSchema }) {
  const tx = useText(), { language } = useI18n()
  const labels: Record<string, string> = {
    sourceLanguage: tx("workflow.task.source.language"), targetLanguage: tx("workflow.task.target.language"),
    initialPrompt: tx("workflow.task.recognition.prompt"), maxCompletionTokens: tx("workflow.task.maximum.output.tokens"),
    voice: tx("workflow.task.voice"), mode: tx("workflow.task.mode"), id: tx("workflow.task.voice.2"),
    keepBackground: tx("workflow.task.keep.background.audio"), renderSubtitles: tx("workflow.task.render.subtitles"),
  }
  const names: Record<string, string> = { en: tx("workflow.task.english"), zh: tx("workflow.task.chinese"), ja: tx("workflow.task.japanese"), auto: tx("workflow.task.auto.detect"), source_clone: tx("workflow.task.source.voice.clone"), preset: tx("workflow.task.preset.voice") }
  return <dl className="space-y-3 rounded-xl border border-border bg-card p-4">{Object.entries(value).map(([key, item]) => {
    const field = schema?.properties?.[key]
    return <div key={key} className="space-y-1"><dt className="text-xs text-muted-foreground">{text(field?.['x-title'] ?? field?.title, language) || labels[key] || key}</dt><dd className="break-words whitespace-pre-wrap text-sm">{item && typeof item === 'object' && !Array.isArray(item) ? <ConfigurationValues value={item as JsonObject} schema={field} /> : typeof item === 'boolean' ? item ? tx("workflow.task.on") : tx("workflow.task.off") : item === null || item === '' ? '—' : typeof item === 'string' ? names[item] || item : JSON.stringify(item)}</dd></div>
  })}</dl>
}
function TranscriptEditor({ value, readOnly, onChange, onSeek }: { value: Transcript; readOnly: boolean; onChange(value: Transcript): void; onSeek?(seconds: number): void }) {
  const tx = useText(), [search, setSearch] = useState('')
  const visible = value.segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => !search || segment.text.toLowerCase().includes(search.toLowerCase()))
  function update(index: number, patch: Partial<Transcript['segments'][number]>) {
    onChange({ ...value, segments: value.segments.map((segment, i) => i === index ? { ...segment, ...patch, words: null } : segment) })
  }
  return <section className="space-y-2"><div className="relative max-w-sm"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={tx("workflow.task.search.transcript")} placeholder={tx("workflow.task.search.transcript")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!visible.length && <p className="py-4 text-sm text-muted-foreground" role="status">{tx("workflow.task.no.matching.text")}</p>}
    {visible.map(({ segment, index }) => <div key={segment.id} className="grid items-start gap-2 rounded-lg border border-border bg-card p-2 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-1">
        <div className="flex min-h-7 items-center justify-between gap-1"><span className="truncate text-xs text-muted-foreground" title={String(segment.id)}>{index + 1}</span>{onSeek && <Button size="xs" variant="ghost" onClick={() => onSeek(segment.start_ms / 1000)}>{tx("workflow.task.locate")}</Button>}</div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground">{tx("workflow.task.start.s")}<Input className="h-7 px-2 text-xs md:text-xs" aria-label={`${tx("workflow.task.start")} ${index + 1}`} type="number" step="0.001" min="0" readOnly={readOnly} value={segment.start_ms / 1000} onChange={(event) => update(index, { start_ms: Math.round(Number(event.target.value) * 1000) })} /></label>
          <label className="flex items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground">{tx("workflow.task.end.s")}<Input className="h-7 px-2 text-xs md:text-xs" aria-label={`${tx("workflow.task.end")} ${index + 1}`} type="number" step="0.001" min="0" readOnly={readOnly} value={segment.end_ms / 1000} onChange={(event) => update(index, { end_ms: Math.round(Number(event.target.value) * 1000) })} /></label>
        </div>
      </div>
      <SegmentTextArea aria-label={`${tx("workflow.task.transcript")} ${index + 1}`} readOnly={readOnly} value={segment.text} onChange={(event) => update(index, { text: event.target.value })} />
    </div>)}
  </section>
}
export function TranscriptNodeDetails({ detail, outputs, draft, readOnly, onDraftChange }: NodeDetailProps) {
  const audio = detail.inputs.audio as { id?: string; schemaId?: string } | undefined
  const url = audio?.id ? assetUrl(`/api/v2/tasks/${encodeURIComponent(detail.taskId)}/artifacts/${encodeURIComponent(audio.id)}`) : ''
  const ref = useRef<HTMLAudioElement>(null)
  useReleaseMediaOnUnmount(ref, url)
  const value = (draft.transcript ?? outputs.transcript) as Transcript | undefined
  return value ? <div className="space-y-3">{url && <audio ref={ref} controls preload="metadata" src={url} className="sticky top-4 z-10 h-10 w-full" />}<TranscriptEditor value={value} readOnly={readOnly} onSeek={url ? (seconds) => { if (ref.current) ref.current.currentTime = seconds } : undefined} onChange={(transcript) => onDraftChange({ ...draft, transcript })} /></div> : null
}
export function TranslationNodeDetails({ detail, outputs, draft, readOnly, onDraftChange }: NodeDetailProps) {
  const value = (draft.translation ?? outputs.translation) as Translation | undefined
  return value ? <TranslationEditor value={value} transcript={detail.inputs.transcript as Transcript | undefined} readOnly={readOnly} onChange={(translation) => onDraftChange({ ...draft, translation })} /> : null
}
function TranslationEditor({ value, transcript, readOnly, onChange }: { value: Translation; transcript?: Transcript; readOnly: boolean; onChange(value: Translation): void }) {
  const tx = useText(), [search, setSearch] = useState('')
  const visible = value.segments.map((segment, index) => ({ segment, index, source: transcript?.segments.find((item) => item.id === segment.segment_id)?.text ?? '' })).filter(({ segment, source }) => !search || `${source} ${segment.text}`.toLowerCase().includes(search.toLowerCase()))
  return <section className="space-y-2"><div className="relative max-w-sm"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={tx("workflow.task.search.translation")} placeholder={tx("workflow.task.search.translation")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!visible.length && <p className="py-4 text-sm text-muted-foreground" role="status">{tx("workflow.task.no.matching.text")}</p>}
    {visible.map(({ segment, index, source }) => {
      return <div key={segment.segment_id} className={`grid items-start gap-2 rounded-lg border border-border bg-card p-2 ${transcript ? 'md:grid-cols-2' : ''}`}>
        {transcript && <div className="min-w-0"><span className="block truncate text-xs leading-4 text-muted-foreground" title={String(segment.segment_id)}>{index + 1}</span><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5">{source}</p></div>}
        <label className="grid min-w-0 gap-1 text-xs leading-4 text-muted-foreground">{tx("workflow.task.translation")}{!transcript && ` ${index + 1}`}<SegmentTextArea aria-label={`${tx("workflow.task.translation")} ${index + 1}`} readOnly={readOnly} value={segment.text} onChange={(event) => onChange({ ...value, segments: value.segments.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} /></label>
      </div>
    })}
  </section>
}
function SpeechResult({ taskId, value, translation, historical, raw }: { taskId: string; value: SpeechAudio; translation?: Translation; historical: boolean; raw: JsonObject }) {
  const tx = useText()
  return <div className="space-y-3">
    {historical && <p className="text-sm text-muted-foreground">{tx("workflow.task.this.historical.version.has.no.saved.text")}</p>}
    <ol className="space-y-2">{value.segments.map((segment, index) => {
      // The worker preserves the translation segment ID; array order is not an association.
      const matches = historical ? [] : translation?.segments.filter((item) => item.segment_id === segment.id) ?? []
      const sentence = matches.length === 1 ? matches[0].text : undefined
      const url = assetUrl(`/api/v2/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(segment.audio.id)}`)
      const label = `${tx("workflow.task.speech")} ${index + 1}`
      return <li key={`${segment.id}-${index}`} aria-label={label} className="grid items-center gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-2">
        <div className="min-w-0"><span className="text-xs text-muted-foreground" title={segment.id}>{index + 1}</span>{sentence ? <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-5">{sentence}</p> : !historical && <p className="mt-1 text-sm text-muted-foreground">{tx("workflow.task.no.unique.matching.translation")}</p>}</div>
        <div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><Media url={url} video={false} label={label} /></div><a href={url} download aria-label={`${tx("workflow.task.download.audio")} ${index + 1}`} title={tx("workflow.task.download.audio")} className="shrink-0 rounded-md p-2 text-link hover:bg-muted"><Download className="size-4" /></a></div>
      </li>
    })}</ol>
    <RawResult value={raw} />
  </div>
}
function Media({ url, video, label }: { url: string; video: boolean; label?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null), videoRef = useRef<HTMLVideoElement>(null)
  useReleaseMediaOnUnmount(audioRef, url); useReleaseMediaOnUnmount(videoRef, url)
  return video ? <video ref={videoRef} aria-label={label} src={url} controls preload="metadata" className="max-h-96 w-full rounded-xl bg-black" /> : <audio ref={audioRef} aria-label={label} src={url} controls preload="metadata" className="h-10 w-full min-w-0" />
}
function RawResult({ value }: { value: unknown }) {
  const tx = useText()
  return <details className="rounded-lg border border-border bg-card p-2"><summary className="cursor-pointer text-xs text-muted-foreground">{tx("workflow.task.raw.data")}</summary><pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-2 text-xs">{JSON.stringify(value, null, 2)}</pre></details>
}
function ResultViewer({ taskId, value }: { taskId: string; value: unknown }) {
  const tx = useText()
  const artifacts = new Map<string, { id: string; schemaId: string }>()
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return
    const object = item as JsonObject
    if (typeof object.id === 'string' && typeof object.schemaId === 'string') artifacts.set(object.id, object as { id: string; schemaId: string })
    else Object.values(object).forEach(visit)
  }
  visit(value)
  return <div className="space-y-2">{[...artifacts.values()].map((artifact, index) => {
    const url = assetUrl(`/api/v2/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.id)}`)
    const audio = artifact.schemaId.startsWith('audio/'), video = artifact.schemaId.startsWith('video/')
    return <div key={artifact.id} className={`rounded-lg border border-border bg-card p-2 ${audio ? 'flex flex-col gap-2 sm:flex-row sm:items-center' : 'space-y-2'}`}>
      {(audio || video) && <div className="min-w-0 flex-1"><Media url={url} video={video} /></div>}
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 text-xs text-link"><Download className="size-4" />{audio ? tx("workflow.task.open.audio") : video ? tx("workflow.task.open.video") : tx("workflow.task.open.file")}{artifacts.size > 1 ? ` ${index + 1}` : ''}</a>
    </div>
  })}<RawResult value={value} /></div>
}
function NodeLog({ taskId, active, useQuery }: { taskId: string; active: boolean } & Bindings<'useQuery'>) {
  const tx = useText(), [error, setError] = useState('')
  const query = useQuery<string>(`/api/v2/tasks/${taskId}/log`, active ? 3000 : undefined)
  return <section className="space-y-3"><Button variant="outline" size="sm" disabled={!query.data} onClick={() => { void copyText(query.data ?? '').catch((failure: Error) => setError(failure.message)) }}><Copy />{tx("workflow.task.copy.task.log")}</Button>{(query.error || error) && <InlineAlert>{query.error || error}</InlineAlert>}{query.error && <Button variant="outline" size="sm" onClick={query.refresh}><RotateCw />{tx("workflow.task.reload")}</Button>}<pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 text-xs">{query.data}</pre></section>
}
