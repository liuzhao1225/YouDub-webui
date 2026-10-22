import { Segmented } from '@/components/ui/segmented'
import { Surface } from '@/components/ui/surface'
import { Progress } from '@/components/ui/progress'
import { Disclosure } from '@/components/ui/disclosure'
import { Textarea } from '@/components/ui/textarea'
import { assetUrl } from '@/lib/asset-url'
import { copyText } from '@/lib/clipboard'
import { NativeSelect } from '@/components/ui/native-select'
import type { Bindings } from '../sdk'
import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { ArrowLeft, Check, Copy, Download, GitBranch, Loader2, RotateCw, Save, Search } from '@/lib/icons'
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
import { TaskState, taskProgressMessage } from './task-status'
import { NodePluginBoundary } from './workflow-settings'
import { nodeDefinition, copyWorkflowLabels } from './workflow-utils'
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
  return <Textarea {...props} ref={ref} rows={1} value={value}  />
}

export function TaskWorkflowPanel({ task, request, navigate, useQuery }: PanelProps & Bindings<'request' | 'navigate' | 'useQuery'>) {
  if (!task.graphSnapshot) return null
  return <TaskGraph request={request} navigate={navigate} useQuery={useQuery} task={task} />
}
function TaskGraph({ task, request, navigate, useQuery }: { task: TaskView } & Bindings<'request' | 'navigate' | 'useQuery'>) {
  const tx = useText()
  const { data, error, refresh } = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
  return <Surface as="section" className="overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">{tx("workflow.task.workflow")}</h2><div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => {
        setBusy(true); setFailure('')
        const copy = copyWorkflowLabels(task.graphSnapshot!, tx)
        const document = { ...copy, id: crypto.randomUUID(), title: `${copy.title} · ${tx("workflow.task.copy")}` }
        void request<WorkflowDocumentRecord>('/api/v2/workflow-documents', { method: 'POST', body: JSON.stringify({ document }) }).then((record) => navigate(`/workflows/${record.id}?sourceTask=${task.id}`)).catch((failure: Error) => setFailure(failure.message)).finally(() => setBusy(false))
      }}><Copy />{tx("workflow.task.edit.workflow.copy")}</Button>
    </div></header>
    {(error || failure) && <div className="space-y-2 p-4"><InlineAlert>{error || failure}</InlineAlert>{error && <Button variant="outline" size="sm" onClick={refresh}><RotateCw />{tx("workflow.task.reload")}</Button>}</div>}
    <div className="h-[min(60dvh,36rem)] min-h-80">{data && <WorkflowCanvas document={task.graphSnapshot!} types={data.items} steps={task.steps} readOnly onOpen={(id) => navigate(`/tasks/${task.id}/nodes/${id}`)} />}</div>
  </Surface>
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
  const tabsId = useId()
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
    : <ResultViewer taskId={task.id} value={displayed} labels={Object.fromEntries((definition?.outputs ?? []).map(port => [port.name, text(port.label, language)]))} />
  const hasEditor = !!Custom || (!definition?.ui?.detailId && (
    (definition?.corrections?.outputPorts.includes('transcript') && !!displayed.transcript)
    || (definition?.corrections?.outputPorts.includes('translation') && !!displayed.translation)
  ))
  return <Page>
    {guard.dialog}
    <PageHeader leading={<Link href={`/tasks/${task.id}`} aria-label={tx("workflow.task.back.to.task")} title={tx("workflow.task.back.to.task")} className="inline-flex items-center text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /></Link>} title={node?.label || text(definition?.label, language) || text(detail.step.label, language)} badge={<TaskState status={detail.step.status} />} />
    {(error || failure) && <div className="space-y-2"><InlineAlert>{error || failure}</InlineAlert>{error && <Button variant="outline" size="sm" onClick={refresh}><RotateCw />{tx("workflow.task.reload")}</Button>}</div>}
    {detail.step.error && <InlineAlert>{detail.step.error.message}</InlineAlert>}
    {['running', 'waiting'].includes(detail.step.status) && <div className="space-y-2 text-sm text-muted-foreground" role="status">{detail.step.message && <p>{taskProgressMessage(detail.step.message, tx)}</p>}{detail.step.status === 'running' && detail.step.progress != null && <Progress label={tx("workflow.task.node.progress")} value={detail.step.progress} />}</div>}
    {pending && !busy && <div className="space-y-2"><InlineAlert tone="warning">{tx("workflow.task.submission.needs.verification")}</InlineAlert><Button variant="outline" disabled={busy} onClick={() => {
      setBusy(true); void request(`/api/v2/tasks/${task.id}/actions/${pending}`).then(() => { setPending(''); setPatch({}); setFailure(''); refresh() }).catch((error: Error & { status?: number }) => { setFailure(error.message); if (error.status === 404) setPending('') }).finally(() => setBusy(false))
    }}>{tx("workflow.task.check.submission")}</Button></div>}
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3"><Segmented id={tabsId} value={tab} onChange={setTab} ariaLabel={node?.label || text(definition?.label, language) || text(detail.step.label, language)} options={(['result', 'inputs', 'config', 'log'] as const).map(value => ({ value, label: value === 'result' ? tx("workflow.task.results") : value === 'inputs' ? tx("workflow.task.inputs") : value === 'config' ? tx("workflow.task.configuration") : tx("workflow.task.task.log") }))} />
      {tab === 'result' && !!detail.resultRevisions.length && <label className="ml-auto flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">{tx("workflow.task.version")}<NativeSelect  disabled={dirty || busy || !!pending} value={revision} onChange={(event) => setViewRevision(Number(event.target.value))}>{detail.resultRevisions.map((item) => <option key={item.revision} value={item.revision}>{item.revision} · {item.source === 'computed' ? tx("workflow.task.original") : tx("workflow.task.correction")}{detail.approvedRevision === item.revision ? ` · ${tx("workflow.task.approved")}` : ''}</option>)}</NativeSelect></label>}
    </div>
    <div role="tabpanel" id={`${tabsId}-${tab}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="space-y-4">
    {tab === 'result' && historical && !!definition?.corrections && (awaitingReview || terminal) && <Button variant="outline" size="sm" disabled={busy || !!pending || !!newTaskId} onClick={() => {
      const current = detail.resultRevisions.find((item) => item.revision === detail.outputRevision)?.outputs ?? detail.step.outputs ?? {}
      baseline.current = { revision: detail.outputRevision, taskRevision: detail.taskRevision, outputs: current }
      setPatch(correctionPatch(Object.fromEntries(definition.corrections!.outputPorts.filter((port) => port in outputs).map((port) => [port, structuredClone(outputs[port])])), current))
      setViewRevision(null); setPreview(null)
    }}>{tx("workflow.task.restore.this.version.as.a.correction")}</Button>}
    {dirty && <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{tx("workflow.task.unsaved.correction")}</span><Button variant="ghost" size="sm" disabled={busy || !!pending || !!newTaskId} onClick={discardDraft}>{tx("workflow.task.discard.correction.and.reload")}</Button></div>}
    {tab === 'result' && <section className="space-y-4">
      {!Object.keys(outputs).length && <p className="text-sm text-muted-foreground">{tx("workflow.task.no.result.yet")}</p>}
      {Custom ? <NodePluginBoundary key={definition!.ui!.detailId} fallback={generic}><Custom detail={displayedDetail} outputs={dirty ? baseline.current.outputs : outputs} draft={patch} readOnly={!editable} onDraftChange={changeDraft} /></NodePluginBoundary> : definition?.ui?.detailId ? <><InlineAlert>{tx("workflow.task.the.node.detail.plugin.is.unavailable")}</InlineAlert>{generic}</> : definition?.corrections?.outputPorts.includes('transcript') && displayed.transcript ? <TranscriptEditor value={displayed.transcript as Transcript} readOnly={!editable} onChange={(value) => changeDraft({ ...patch, transcript: value })} /> : definition?.corrections?.outputPorts.includes('translation') && displayed.translation ? <TranslationEditor value={displayed.translation as Translation} transcript={transcript} readOnly={!editable} onChange={(value) => changeDraft({ ...patch, translation: value })} /> : generic}
      {hasEditor && Object.entries(displayed).filter(([name]) => name !== 'transcript' && name !== 'translation').map(([name, value]) => <Disclosure key={name} contained={true} title={<>{text(definition?.outputs.find((port) => port.name === name)?.label, language) || (name === 'raw' ? tx("workflow.task.original.response") : name)}</>}><div className="mt-2"><ResultViewer taskId={task.id} value={value} /></div></Disclosure>)}
    </section>}
    {tab === 'inputs' && <ResultViewer taskId={task.id} value={detail.inputs} labels={Object.fromEntries((definition?.inputs ?? []).map(port => [port.id, text(port.label, language)]))} />}
    {tab === 'config' && <NodeConfiguration node={node} definition={definition} raw={node ?? detail.spec} />}
    {tab === 'log' && <NodeLog useQuery={useQuery} active={taskNeedsPolling(task)} taskId={task.id} />}
    {canReview && <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 py-3 backdrop-blur-sm lg:bottom-0">
      <Button variant="outline" disabled={!dirty || busy || !!pending} onClick={() => void submit(false).catch(() => undefined)}><Save />{tx("workflow.task.save.correction")}</Button>
      <Button disabled={busy || !!pending} onClick={() => void submit(true).catch(() => undefined)}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{finishesTask ? dirty ? tx("workflow.task.save.and.complete") : tx("workflow.task.approve.and.complete") : dirty ? tx("workflow.task.save.and.continue") : tx("workflow.task.approve.and.continue")}</Button>
    </div>}
    {((canDerive && dirty) || newTaskId) && <Surface as="section" className="space-y-4 p-4">
      <h2 className="font-semibold">{tx("workflow.task.generate.again.with.corrections")}</h2>
      {!preview && <Button disabled={busy || !!newTaskId} variant="outline" onClick={() => void rerunPreview()}><GitBranch />{tx("workflow.task.review.affected.steps")}</Button>}
      {preview && <><p className="text-sm">{tx("workflow.task.keep.existing.results")}: {preview.reusedSteps.map(nodeName).join('、') || '—'}</p><p className="text-sm">{tx("workflow.task.process.again")}: {preview.dirtySteps.map(nodeName).join('、') || '—'}</p><Button disabled={busy || !!newTaskId} onClick={() => void createDerived()}>{tx("workflow.task.create.task.and.generate")}</Button></>}
      {newTaskId && !busy && <Button variant="outline" onClick={() => { void submissionStore.check(submissionKey, request).then(next => { if (next) openDerived(next) }) }}>{tx("workflow.task.check.task.status")}</Button>}
      {newTaskId && !busy && <Button variant="outline" onClick={() => { void submissionStore.discard(submissionKey, request).then(cleared => { if (cleared && activeView.current) { setPreview(null); setFailure('') } }) }}>{tx("workflow.task.return.to.editing")}</Button>}
    </Surface>}
    </div>
  </Page>
}
function NodeConfiguration({ node, definition, raw }: { node?: GraphNode; definition?: NodeTypeDefinition; raw: unknown }) {
  const tx = useText(), { language } = useI18n()
  return <section className="space-y-4">
    {node && <Surface as="dl" className="divide-y divide-border px-4 [&>div]:grid [&>div]:gap-1 [&>div]:py-3 sm:[&>div]:grid-cols-[minmax(8rem,1fr)_minmax(0,3fr)] sm:[&>div]:gap-6">
      <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.provider")}</dt><dd className="break-words text-sm">{text(definition?.provider.label, language) || node.provider.id}</dd></div>
      {node.provider.model && <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.model")}</dt><dd className="break-words text-sm">{node.provider.model}</dd></div>}
      {node.provider.device && <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.device")}</dt><dd className="text-sm">{node.provider.device.toUpperCase()}</dd></div>}
      <div><dt className="text-xs text-muted-foreground">{tx("workflow.task.after.completion")}</dt><dd className="text-sm">{node.autoContinue ? tx("workflow.task.continue.automatically") : tx("workflow.task.wait.for.approval")}</dd></div>
    </Surface>}
    {node && Object.keys(node.config).length > 0 && <ConfigurationValues value={node.config} schema={definition?.configSchema} />}
    <Disclosure  contained={true} title={<>{tx("workflow.task.raw.configuration")}</>}><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(raw, null, 2)}</pre></Disclosure>
  </section>
}
function ConfigurationValues({ value, schema, nested = false }: { value: JsonObject; schema?: JsonSchema; nested?: boolean }) {
  const tx = useText(), { language } = useI18n()
  const labels: Record<string, string> = {
    sourceLanguage: tx("workflow.task.source.language"), targetLanguage: tx("workflow.task.target.language"),
    initialPrompt: tx("workflow.task.recognition.prompt"), maxCompletionTokens: tx("workflow.task.maximum.output.tokens"),
    voice: tx("workflow.task.voice"), mode: tx("workflow.task.mode"), id: tx("workflow.task.voice.2"),
    keepBackground: tx("workflow.task.keep.background.audio"), renderSubtitles: tx("workflow.task.render.subtitles"),
  }
  const names: Record<string, string> = { en: tx("workflow.task.english"), zh: tx("workflow.task.chinese"), ja: tx("workflow.task.japanese"), auto: tx("workflow.task.auto.detect"), source_clone: tx("workflow.task.source.voice.clone"), preset: tx("workflow.task.preset.voice") }
  const content = <dl className="divide-y divide-border">{Object.entries(value).map(([key, item]) => {
    const field = schema?.properties?.[key]
    return <div key={key} className="grid gap-1 py-3 @min-[640px]/page:grid-cols-[minmax(8rem,1fr)_minmax(0,3fr)] @min-[640px]/page:gap-6"><dt className="text-xs text-muted-foreground">{text(field?.['x-title'] ?? field?.title, language) || labels[key] || key}</dt><dd className="min-w-0 break-words whitespace-pre-wrap text-sm">{item && typeof item === 'object' && !Array.isArray(item) ? <ConfigurationValues value={item as JsonObject} schema={field} nested /> : typeof item === 'boolean' ? item ? tx("workflow.task.on") : tx("workflow.task.off") : item === null || item === '' ? '—' : typeof item === 'string' ? names[item] || item : JSON.stringify(item)}</dd></div>
  })}</dl>
  return nested ? content : <Surface as="div" className="px-4">{content}</Surface>
}
function TranscriptEditor({ value, readOnly, onChange, onSeek }: { value: Transcript; readOnly: boolean; onChange(value: Transcript): void; onSeek?(seconds: number): void }) {
  const tx = useText(), [search, setSearch] = useState('')
  const visible = value.segments.map((segment, index) => ({ segment, index })).filter(({ segment }) => !search || segment.text.toLowerCase().includes(search.toLowerCase()))
  function update(index: number, patch: Partial<Transcript['segments'][number]>) {
    onChange({ ...value, segments: value.segments.map((segment, i) => i === index ? { ...segment, ...patch, words: null } : segment) })
  }
  return <section className="space-y-2"><div className="relative max-w-sm"><Input icon={<Search className="size-4" />} aria-label={tx("workflow.task.search.transcript")} placeholder={tx("workflow.task.search.transcript")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!visible.length && <p className="py-4 text-sm text-muted-foreground" role="status">{tx("workflow.task.no.matching.text")}</p>}
    {visible.length > 0 && <Surface as="div" className="divide-y divide-border overflow-hidden">
    {visible.map(({ segment, index }) => <div key={segment.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 p-3 @min-[720px]/page:grid-cols-[auto_auto_minmax(0,1fr)]">
      <span className="flex h-9 min-w-[2ch] items-center justify-end text-xs tabular-nums text-muted-foreground" title={String(segment.id)}>{index + 1}</span>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-9 items-center gap-1">
          <Input className="w-20 tabular-nums" aria-label={`${tx("workflow.task.start")} ${index + 1}`} title={tx("workflow.task.start.s")} type="number" step="0.001" min="0" readOnly={readOnly} value={segment.start_ms / 1000} onChange={(event) => update(index, { start_ms: Math.round(Number(event.target.value) * 1000) })} />
          <span aria-hidden="true" className="text-xs text-subtle-foreground">—</span>
          <Input className="w-20 tabular-nums" aria-label={`${tx("workflow.task.end")} ${index + 1}`} title={tx("workflow.task.end.s")} type="number" step="0.001" min="0" readOnly={readOnly} value={segment.end_ms / 1000} onChange={(event) => update(index, { end_ms: Math.round(Number(event.target.value) * 1000) })} />
          <span aria-hidden="true" className="pr-2 text-xs text-subtle-foreground">s</span>
        </div>
        {onSeek && <Button size="sm" variant="ghost" aria-label={`${tx("workflow.task.locate")} ${index + 1}`} onClick={() => onSeek(segment.start_ms / 1000)}>{tx("workflow.task.locate")}</Button>}
      </div>
      <div className="col-start-2 min-w-0 @min-[720px]/page:col-start-auto"><SegmentTextArea aria-label={`${tx("workflow.task.transcript")} ${index + 1}`} readOnly={readOnly} value={segment.text} onChange={(event) => update(index, { text: event.target.value })} /></div>
    </div>)}</Surface>}
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
  return <section className="space-y-2"><div className="relative max-w-sm"><Input icon={<Search className="size-4" />} aria-label={tx("workflow.task.search.translation")} placeholder={tx("workflow.task.search.translation")} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {!visible.length && <p className="py-4 text-sm text-muted-foreground" role="status">{tx("workflow.task.no.matching.text")}</p>}
    {visible.length > 0 && <Surface as="div" className="divide-y divide-border overflow-hidden">
      <div aria-hidden="true" className={`hidden gap-3 bg-muted/40 px-3 py-2 text-muted-foreground @min-[640px]/page:grid ${transcript ? 'grid-cols-[2ch_minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-[2ch_minmax(0,1fr)]'}`}><span />{transcript && <span className="text-xs">{tx("workflow.task.transcript")}</span>}<span className="text-xs">{tx("workflow.task.translation")}</span></div>
      {visible.map(({ segment, index, source }) => <div key={segment.segment_id} className={`grid grid-cols-[2ch_minmax(0,1fr)] items-start gap-x-3 gap-y-2 p-3 ${transcript ? '@min-[640px]/page:grid-cols-[2ch_minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
        <span className="flex h-9 items-center justify-end text-xs tabular-nums text-muted-foreground" title={String(segment.segment_id)}>{index + 1}</span>
        {transcript && <div className="min-w-0"><span className="text-xs text-muted-foreground @min-[640px]/page:hidden">{tx("workflow.task.transcript")}</span><p className="py-1.5 whitespace-pre-wrap break-words text-sm leading-5">{source}</p></div>}
        <div className={`min-w-0 ${transcript ? 'col-start-2 @min-[640px]/page:col-start-auto' : ''}`}><span className="text-xs text-muted-foreground @min-[640px]/page:hidden">{tx("workflow.task.translation")}</span><SegmentTextArea aria-label={`${tx("workflow.task.translation")} ${index + 1}`} readOnly={readOnly} value={segment.text} onChange={(event) => onChange({ ...value, segments: value.segments.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} /></div>
      </div>)}
    </Surface>}
  </section>
}
function SpeechResult({ taskId, value, translation, historical, raw }: { taskId: string; value: SpeechAudio; translation?: Translation; historical: boolean; raw: JsonObject }) {
  const tx = useText()
  return <div className="space-y-3">
    {historical && <p className="text-sm text-muted-foreground">{tx("workflow.task.this.historical.version.has.no.saved.text")}</p>}
    <Surface as="ol" className="divide-y divide-border overflow-hidden">{value.segments.map((segment, index) => {
      // The worker preserves the translation segment ID; array order is not an association.
      const matches = historical ? [] : translation?.segments.filter((item) => item.segment_id === segment.id) ?? []
      const sentence = matches.length === 1 ? matches[0].text : undefined
      const url = assetUrl(`/api/v2/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(segment.audio.id)}`)
      const label = `${tx("workflow.task.speech")} ${index + 1}`
      return <li key={`${segment.id}-${index}`} aria-label={label} className="grid grid-cols-[2ch_minmax(0,1fr)] items-center gap-3 p-3 @min-[640px]/page:grid-cols-[2ch_minmax(0,1fr)_minmax(16rem,1fr)]">
        <span className="text-right text-xs tabular-nums text-muted-foreground" title={segment.id}>{index + 1}</span>
        <div className="min-w-0">{sentence ? <p className="whitespace-pre-wrap break-words text-sm leading-5">{sentence}</p> : !historical && <p className="text-sm text-muted-foreground">{tx("workflow.task.no.unique.matching.translation")}</p>}</div>
        <div className="col-start-2 flex min-w-0 items-center gap-2 @min-[640px]/page:col-start-auto"><div className="min-w-0 flex-1"><Media url={url} video={false} label={label} /></div><a href={url} download aria-label={`${tx("workflow.task.download.audio")} ${index + 1}`} title={tx("workflow.task.download.audio")} className="shrink-0 rounded-md p-2 text-link hover:bg-muted"><Download className="size-4" /></a></div>
      </li>
    })}</Surface>
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
  return <Disclosure  contained={true} title={<>{tx("workflow.task.raw.data")}</>}><pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre></Disclosure>
}
function ResultViewer({ taskId, value, labels = {} }: { taskId: string; value: unknown; labels?: Record<string, string> }) {
  const tx = useText()
  const artifacts = new Map<string, { id: string; schemaId: string; label: string }>()
  const visit = (item: unknown, label = '') => {
    if (!item || typeof item !== 'object') return
    const object = item as JsonObject
    if (typeof object.id === 'string' && typeof object.schemaId === 'string') artifacts.set(object.id, { id: object.id, schemaId: object.schemaId, label })
    else Object.entries(object).forEach(([key, child]) => visit(child, label || labels[key] || ''))
  }
  visit(value)
  const counts = new Map<string, number>(), seen = new Map<string, number>()
  for (const artifact of artifacts.values()) counts.set(artifact.label, (counts.get(artifact.label) ?? 0) + 1)
  return <div className="space-y-2">{[...artifacts.values()].map((artifact, index) => {
    const url = assetUrl(`/api/v2/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.id)}`)
    const audio = artifact.schemaId.startsWith('audio/'), video = artifact.schemaId.startsWith('video/')
    seen.set(artifact.label, (seen.get(artifact.label) ?? 0) + 1)
    const label = artifact.label + ((counts.get(artifact.label) ?? 0) > 1 ? ` ${seen.get(artifact.label)}` : '')
    return <Surface as="div" key={artifact.id} className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">{artifact.label && <span className="text-sm font-medium">{label}</span>}<a href={url} target="_blank" rel="noreferrer" className="ml-auto inline-flex shrink-0 items-center gap-2 text-xs text-link"><Download className="size-4" />{audio ? tx("workflow.task.open.audio") : video ? tx("workflow.task.open.video") : tx("workflow.task.open.file")}{!artifact.label && artifacts.size > 1 ? ` ${index + 1}` : ''}</a></div>
      {(audio || video) && <div className="min-w-0 flex-1"><Media url={url} video={video} /></div>}
    </Surface>
  })}<RawResult value={value} /></div>
}
function NodeLog({ taskId, active, useQuery }: { taskId: string; active: boolean } & Bindings<'useQuery'>) {
  const tx = useText(), [error, setError] = useState('')
  const query = useQuery<string>(`/api/v2/tasks/${taskId}/log`, active ? 3000 : undefined)
  return <section className="space-y-3">{(query.error || error) && <InlineAlert>{query.error || error}</InlineAlert>}<Surface as="div" className="overflow-hidden"><div className="flex items-center justify-end gap-2 border-b border-border p-3">{query.error && <Button variant="outline" size="sm" onClick={query.refresh}><RotateCw />{tx("workflow.task.reload")}</Button>}<Button variant="outline" size="sm" disabled={!query.data} onClick={() => { void copyText(query.data ?? '').catch((failure: Error) => setError(failure.message)) }}><Copy />{tx("workflow.task.copy.task.log")}</Button></div><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-relaxed">{query.data}</pre></Surface></section>
}
