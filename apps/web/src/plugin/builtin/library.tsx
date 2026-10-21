import { NativeSelect, Choice } from '@/components/ui/native-select'
import { bindComponent, type Bindings } from '../sdk'
import { Context } from 'cordis'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Download, FileText, ListVideo, Loader2, RotateCw, Square, Trash2 } from 'lucide-react'
import { Link, text, type Catalog, type JsonObject, type PanelProps, type RouteProps, type TaskAction, type TaskPage, type TaskView, type WorkflowDescription } from '../sdk'
import { StudioDraftStore } from '@/runtime/studio-draft'
import { protectPendingSubmissions, useActiveView, useObservableSource, usePendingUnload } from '../view-hooks'
import { taskNeedsPolling } from '../runtime/query'
import { useI18n, useText } from '@/lib/i18n'
import { useReleaseMediaOnUnmount } from '@/lib/media'
import { formatBytes, formatDateTime } from '@/lib/format'
import { TaskCover } from '@/components/task-cover'
import { VideoPlayer } from '@/components/video-player'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Page, PageHeader } from '@/components/page-layout'
import { ConfigEditor, defaultConfig, useEditorSupported } from './schema-form'
import { STATUS_LABELS, TaskProgress, TaskState, taskDisplayName } from './task-status'

export function Library({ useQuery, navigate }: Bindings<'useQuery' | 'navigate'>) {
  const tx = useText()
  const [status, setStatus] = useState(''), [offset, setOffset] = useState(0)
  const { data, error, refresh } = useQuery<TaskPage>(`/api/v2/tasks?limit=20&offset=${offset}${status ? `&status=${status}` : ''}`, 3000)
  return <Page>
    <PageHeader title={tx("library.library")} actions={<Button onClick={() => navigate('/')}>{tx("library.new.task")}</Button>} />
    <div className="flex flex-wrap items-center gap-2"><NativeSelect aria-label={tx("library.task.status")} value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0) }} className="h-9 rounded-lg border border-input bg-input-bg px-3 text-sm"><option value="">{tx("library.all.statuses")}</option>{['queued', 'running', 'waiting', 'paused', 'cancelling', 'succeeded', 'failed', 'cancelled'].map((item) => <option key={item} value={item}>{tx(STATUS_LABELS[item])}</option>)}</NativeSelect><Button variant="ghost" size="sm" onClick={refresh}><RotateCw />{tx("library.refresh")}</Button></div>
    {error && <InlineAlert>{error}</InlineAlert>}
    {!data && !error && <p role="status" className="py-12 text-center text-sm text-muted-foreground">{tx("library.loading")}</p>}
    {data && !data.items.length && <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">{status ? tx("library.no.tasks.with.this.status") : tx("library.no.tasks.yet")}</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data?.items.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-colors outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40">
      <TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="lg" className="rounded-none" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3"><h2 title={taskDisplayName(task)} className="line-clamp-2 min-w-0 break-words font-medium">{taskDisplayName(task)}</h2><TaskState status={task.status} /></div>
        <TaskProgress task={task} />
        {task.error && <p className="line-clamp-2 break-words text-xs text-status-danger-fg">{task.error.message}</p>}
        <time dateTime={task.createdAt} className="mt-auto text-xs text-subtle-foreground">{formatDateTime(task.createdAt)}</time>
      </div>
    </Link>)}</div>
    <div className="flex justify-end gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{tx("library.previous")}</Button><Button variant="outline" disabled={!data?.hasMore} onClick={() => setOffset(offset + 20)}>{tx("library.next")}</Button></div>
  </Page>
}
function RerunEditor({ submissionStore, task, close, locked, onLockChange, request, navigate, useQuery, useSlot }: { submissionStore: StudioDraftStore; task: TaskView; close(): void; locked: boolean; onLockChange(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot'>) {
  const tx = useText()
  const { language } = useI18n()
  const { data: catalog, error } = useQuery<Catalog>('/api/v2/catalog')
  const [selected, setSelected] = useState(() => { const pending = Object.values(submissionStore.getSnapshot().submissions).find(item => item.path === `/api/v2/tasks/${task.id}/rerun`); return pending && typeof pending.body === 'string' ? JSON.parse(pending.body).workflowId as string : task.workflowId })
  const workflow = catalog?.workflows.find((item) => item.id === selected) ?? catalog?.workflows[0]
  return <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
    <h2 className="font-semibold">{tx("library.generate.again")}</h2>
    {error && <InlineAlert>{error}</InlineAlert>}
    {catalog && !workflow && <InlineAlert>{tx("library.no.workflows.are.available")}</InlineAlert>}
    {workflow && <><label className="grid gap-2 text-sm">{tx("library.workflow")}<NativeSelect disabled={locked} value={workflow.id} onChange={(event) => setSelected(event.target.value)} className="h-10 rounded-lg border border-input bg-input-bg px-3">{catalog!.workflows.map((item) => <option key={item.id} value={item.id}>{text(item.label, language)}</option>)}</NativeSelect></label><RerunForm submissionStore={submissionStore} request={request} navigate={navigate} useSlot={useSlot} key={`${workflow.id}:${workflow.version}`} task={task} workflow={workflow} close={close} onLockChange={onLockChange} /></>}
    {!workflow && <Button variant="outline" onClick={close}>{tx("library.close")}</Button>}
  </section>
}
function RerunForm({ submissionStore, task, workflow, close, onLockChange, request, navigate, useSlot }: { submissionStore: StudioDraftStore; task: TaskView; workflow: WorkflowDescription; close(): void; onLockChange(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useSlot'>) {
  const tx = useText()
  const savedSubmission = submissionStore.getSnapshot().submissions[`rerun:${task.id}:${workflow.id}:${workflow.version}`]
  const savedRequest = savedSubmission && typeof savedSubmission.body === 'string' ? JSON.parse(savedSubmission.body) as { config: JsonObject; acknowledgeExternalRisk: boolean } : undefined
  const [config, setConfig] = useState<JsonObject>(() => structuredClone(savedRequest?.config ?? (task.workflowId === workflow.id ? task.config : workflow.defaults ?? defaultConfig(workflow.configSchema) ?? {})) as JsonObject)
  const { submissions } = useObservableSource(submissionStore)
  const submissionKey = `rerun:${task.id}:${workflow.id}:${workflow.version}`, submission = submissions[submissionKey]
  const failure = submission?.error ?? '', busy = !!submission?.busy, submitted = !!submission, newId = submission?.id
  const [acknowledged, setAcknowledged] = useState(savedRequest?.acknowledgeExternalRisk ?? false)
  const activeView = useActiveView()
  usePendingUnload(submitted)
  useEffect(() => { onLockChange(submitted) }, [onLockChange, submitted])
  function openTask(next: TaskView) { if (!activeView.current) return; submissionStore.clearSubmission(submissionKey); navigate(`/tasks/${next.id}`) }
  const supported = useEditorSupported(useSlot, workflow.id, workflow.configSchema)
  return <div className="space-y-5">
    <ConfigEditor useSlot={useSlot} ownerId={workflow.id} value={config} schema={workflow.configSchema} diagnostics={[]} readOnly={busy || submitted} onChange={setConfig} />
    {task.mayStillRun && <Choice className="flex gap-2 text-sm" label={tx("library.the.remote.request.may.still.be.running.create.a.new.task")} disabled={submitted} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />}
    {failure && <InlineAlert>{failure} · {newId}</InlineAlert>}
    {submitted && !busy && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => {
      void submissionStore.check(submissionKey, request).then(next => { if (next) openTask(next) })
    }}>{tx("library.check.task.status")}</Button><Button variant="outline" onClick={() => {
      void submissionStore.discard(submissionKey, request)
    }}>{tx("library.clear.this.import")}</Button></div>}
    <div className="flex gap-2"><Button disabled={!supported || busy || (task.mayStillRun && !acknowledged)} onClick={() => {
      if (busy) return
      void submissionStore.submit(submissionKey, request, JSON.stringify({ id: newId || crypto.randomUUID(), workflowId: workflow.id, config, acknowledgeExternalRisk: acknowledged }), `/api/v2/tasks/${task.id}/rerun`).then(next => { if (next) openTask(next) })
    }}>{busy && <Loader2 className="animate-spin" />}{submitted ? tx("library.submit.with.the.same.id") : tx("library.create.task")}</Button><Button variant="outline" onClick={close} disabled={busy || submitted}>{tx("library.close")}</Button></div>
  </div>
}
function Actions({ heading, submissionStore, task, refresh, prepareDelete, request, navigate, useQuery, useSlot }: PanelProps & { heading: ReactNode; submissionStore: StudioDraftStore; prepareDelete(value: boolean): void } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot'>) {
  const tx = useText()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false), [rerun, setRerun] = useState(() => Object.values(submissionStore.getSnapshot().submissions).some(item => item.path === `/api/v2/tasks/${task.id}/rerun`)), [rerunLocked, setRerunLocked] = useState(false)
  async function act(action: TaskAction) {
    if (busy) return
    setBusy(true); setError('')
    try {
      await request(`/api/v2/tasks/${task.id}${action === 'delete' ? `?expectedAttempt=${task.attempt}` : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST', ...(action === 'delete' ? {} : { body: JSON.stringify({ expectedAttempt: task.attempt, ...(task.graphSnapshot ? { expectedTaskRevision: task.revision } : {}) }) }) })
      if (action === 'delete') navigate('/tasks'); else refresh()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <header className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3">{heading}<div className="flex flex-wrap items-center gap-2">{task.allowedActions.includes('cancel') && <Button variant="outline" disabled={busy || rerunLocked} onClick={() => void act('cancel')}><Square />{tx("library.cancel.task")}</Button>}{task.allowedActions.includes('retry') && <Button disabled={busy || rerunLocked} onClick={() => void act('retry')}><RotateCw />{tx("library.retry.from.start")}</Button>}{!task.graphSnapshot && task.allowedActions.includes('rerun') && <Button variant="outline" disabled={busy || rerunLocked} onClick={() => setRerun(!rerun)}>{tx("library.generate.again")}</Button>}{task.allowedActions.includes('delete') && <Button variant={confirmDelete ? 'destructive' : 'ghost'} disabled={busy || rerunLocked} onClick={() => { if (confirmDelete) void act('delete'); else { setConfirmDelete(true); prepareDelete(true) } }}><Trash2 />{confirmDelete ? tx("library.delete.task.and.files") : tx("library.delete.task")}</Button>}{confirmDelete && <Button variant="ghost" onClick={() => { setConfirmDelete(false); prepareDelete(false) }}>{tx("library.keep.task")}</Button>}</div></div>{task.mayStillRun && <InlineAlert tone="warning">{tx("library.the.remote.request.may.still.be.running")}</InlineAlert>}{error && <InlineAlert>{error}</InlineAlert>}{rerun && <RerunEditor submissionStore={submissionStore} request={request} navigate={navigate} useQuery={useQuery} useSlot={useSlot} task={task} close={() => setRerun(false)} locked={rerunLocked} onLockChange={setRerunLocked} />}</header>
}
export function TaskDetail({ submissionStore, params, request, navigate, useQuery, useSlot }: RouteProps & { submissionStore: StudioDraftStore } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot'>) {
  const tx = useText(), { language } = useI18n()
  const { data: task, error, refresh } = useQuery<TaskView>(`/api/v2/tasks/${encodeURIComponent(params.id)}`, 1500, taskNeedsPolling)
  const panels = useSlot('task.detail.panels'), actions = useSlot('task.detail.actions')
  const [mediaReleased, setMediaReleased] = useState(false), [showLog, setShowLog] = useState(false)
  const loadError = error && <div className="space-y-2"><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx("library.reload.task")}</Button></div>
  if (!task) return <Page className="space-y-4 py-4">{loadError || <p role="status">{tx("library.loading")}</p>}</Page>
  const video = task.outputs.find((output) => output.mimeType?.startsWith('video/'))
  const completed = task.steps.filter((step) => step.status === 'completed').length
  const stepList = <ol className="space-y-4">{task.steps.map((step) => <li key={step.id} className="flex gap-3">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent">{step.status === 'completed' ? <Check className="size-4 text-status-success-fg" /> : step.status === 'running' ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4 text-muted-foreground" />}</span>
    <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2">{task.graphSnapshot ? <Link href={`/tasks/${task.id}/nodes/${step.id}`} className="text-sm font-medium text-link">{text(step.label, language)}</Link> : <span className="text-sm font-medium">{text(step.label, language)}</span>}<TaskState status={step.status} /></div>
      {step.progress != null && step.status === 'running' && <progress aria-label={`${text(step.label, language)} ${tx("library.progress")}`} value={step.progress} max={1} className="mt-2 h-1 w-full accent-primary" />}
      {step.message && <p className="mt-1 break-words text-xs text-muted-foreground">{step.message}</p>}{step.error && <p className="mt-1 text-xs text-status-danger-fg">{step.error.message}</p>}
    </div>
  </li>)}</ol>
  return <Page className="space-y-4 py-4">
    <Actions submissionStore={submissionStore} useQuery={useQuery} useSlot={useSlot} request={request} navigate={navigate} task={task} refresh={refresh} prepareDelete={setMediaReleased} heading={<div className="min-w-0 flex-auto space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href="/tasks" className="inline-flex shrink-0 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />{tx("library.library")}</Link>
        <span aria-hidden="true" className="text-subtle-foreground">/</span>
        <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight">{taskDisplayName(task)}</h1>
        <TaskState status={task.status} />
      </div>
      <p className="text-xs text-muted-foreground">{taskDisplayName(task) !== (task.graphSnapshot?.title || task.workflowId) && <>{task.graphSnapshot?.title || task.workflowId} · </>}<time dateTime={task.createdAt}>{formatDateTime(task.createdAt)}</time></p>
    </div>} />
    {loadError}{task.error && <InlineAlert>{task.error.message}</InlineAlert>}
    {actions.map(({ id, component: Component }) => <Component key={id} task={task} refresh={refresh} />)}
    {video && !mediaReleased && <div className="overflow-hidden rounded-2xl border border-border bg-black"><VideoPlayer src={video.url} /></div>}
    {!!task.outputs.length && <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card"><h2 className="font-semibold">{tx("library.generated.files")}</h2><div className="grid gap-3 sm:grid-cols-2">{task.outputs.map((output) => <div key={output.id} className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{output.label || output.name || output.id}</p>{output.size !== undefined && <p className="mt-1 text-xs text-muted-foreground">{formatBytes(output.size)}</p>}</div><a href={output.url} download className="rounded-lg p-2 hover:bg-accent" aria-label={`${tx("library.download")} ${output.label || output.id}`}><Download className="size-4" /></a></div>
      {!mediaReleased && output.mimeType?.startsWith('audio/') && <AudioOutput src={output.url} />}
      {(output.mimeType?.startsWith('text/') || output.mimeType === 'application/x-subrip') && <a href={output.url} target="_blank" rel="noreferrer" className="text-xs text-link">{tx("library.preview.text")}</a>}
    </div>)}</div></section>}
    {panels.map(({ id, component: Component }) => <Component key={id} task={task} refresh={refresh} />)}
    {task.graphSnapshot ? <details className="rounded-2xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-medium">{tx("library.step.list")} · {completed}/{task.steps.length}</summary><div className="mt-4">{stepList}</div></details> : <section className="rounded-2xl border border-border bg-card p-5"><h2 className="mb-4 font-semibold">{tx("library.steps")} · {completed}/{task.steps.length}</h2>{stepList}</section>}
    <details onToggle={(event) => setShowLog(event.currentTarget.open)} className="rounded-2xl border border-border bg-card p-5"><summary className="cursor-pointer text-sm font-medium">{tx("library.task.log")}</summary>{showLog && <TaskLog useQuery={useQuery} active={taskNeedsPolling(task)} id={task.id} />}</details>
  </Page>
}
function AudioOutput({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  useReleaseMediaOnUnmount(ref, src)
  return <audio ref={ref} controls src={src} className="h-10 w-full" />
}
function TaskLog({ id, active, useQuery }: { id: string; active: boolean } & Bindings<'useQuery'>) {
  const tx = useText()
  const { data, error, refresh } = useQuery<string>(`/api/v2/tasks/${id}/log`, active ? 2000 : undefined)
  return error ? <div className="mt-4 space-y-2"><InlineAlert>{error}</InlineAlert><Button size="sm" variant="outline" onClick={refresh}>{tx("library.reload.log")}</Button></div> : <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono text-xs">{data ?? tx("library.loading")}</pre>
}
export const name = 'client-library'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  const submissionStore = new StudioDraftStore()
  ctx.effect(() => () => submissionStore.reset())
  protectPendingSubmissions(ctx, submissionStore)
  const BoundTaskDetail = bindComponent(ctx, ['request', 'navigate', 'useQuery', 'useSlot'], TaskDetail)
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'library', path: '/tasks', component: bindComponent(ctx, ['useQuery','navigate'], Library), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'task-detail', path: '/tasks/:id', component: props => <BoundTaskDetail {...props} submissionStore={submissionStore} />, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'library', routeId: 'library', label: { default: 'Library', translations: { zh: '任务库', ja: 'タスク' } }, order: 20, icon: ListVideo }))
}
