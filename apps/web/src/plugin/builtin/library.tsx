import { Surface } from '@/components/ui/surface'
import { Progress } from '@/components/ui/progress'
import { Disclosure } from '@/components/ui/disclosure'
import { NativeSelect, Choice } from '@/components/ui/native-select'
import { bindComponent, type Bindings } from '../sdk'
import { Context } from 'cordis'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, AudioLines, Captions, Check, Download, FileText, Film, ListVideo, Loader2, RotateCw, Square, Trash2 } from '@/lib/icons'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Modal } from '../../components/ui/harness-primitives'
import { cn } from '@/lib/utils'
import { Page, PageHeader } from '@/components/page-layout'
import { ConfigEditor, defaultConfig, useEditorSupported } from './schema-form'
import { workflowTemplateTitle, workflowPortLabel } from './workflow-utils'
import { STATUS_LABELS, TaskProgress, TaskState, taskDisplayName, taskProgressMessage } from './task-status'

export function Library({ useQuery, navigate }: Bindings<'useQuery' | 'navigate'>) {
  const tx = useText()
  const [status, setStatus] = useState(''), [offset, setOffset] = useState(0)
  const { data, error, refresh } = useQuery<TaskPage>(`/api/v2/tasks?limit=20&offset=${offset}${status ? `&status=${status}` : ''}`, 3000)
  return <Page>
    <PageHeader title={tx("library.library")} actions={<Button size="sm" onClick={() => navigate('/')}>{tx("library.new.task")}</Button>} />
    <div className="flex flex-wrap items-center gap-2"><NativeSelect aria-label={tx("library.task.status")} value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0) }} ><option value="">{tx("library.all.statuses")}</option>{['queued', 'running', 'waiting', 'paused', 'cancelling', 'succeeded', 'failed', 'cancelled'].map((item) => <option key={item} value={item}>{tx(STATUS_LABELS[item])}</option>)}</NativeSelect><Button variant="ghost" size="sm" onClick={refresh}><RotateCw />{tx("library.refresh")}</Button></div>
    {error && <InlineAlert>{error}</InlineAlert>}
    {!data && !error && <p role="status" className="py-12 text-center text-sm text-muted-foreground">{tx("library.loading")}</p>}
    {data && !data.items.length && <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">{offset > 0 ? tx("library.no.tasks.on.this.page") : status ? tx("library.no.tasks.with.this.status") : tx("library.no.tasks.yet")}</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data?.items.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40">
      <TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="lg" className="rounded-none" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3"><h2 title={taskDisplayName(task)} className="line-clamp-2 min-w-0 break-words font-medium">{taskDisplayName(task)}</h2><TaskState status={task.status} /></div>
        <TaskProgress task={task} />
        {task.error && <p className="line-clamp-2 break-words text-xs text-status-danger-fg">{task.error.message}</p>}
        <time dateTime={task.createdAt} className="mt-auto text-xs text-muted-foreground">{formatDateTime(task.createdAt)}</time>
      </div>
    </Link>)}</div>
    {(offset > 0 || data?.hasMore) && <div className="flex justify-end gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{tx("library.previous")}</Button><Button variant="outline" disabled={!data?.hasMore} onClick={() => setOffset(offset + 20)}>{tx("library.next")}</Button></div>}
  </Page>
}
function RerunEditor({ submissionStore, task, close, locked, onLockChange, request, navigate, useQuery, useSlot }: { submissionStore: StudioDraftStore; task: TaskView; close(): void; locked: boolean; onLockChange(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot'>) {
  const tx = useText()
  const { language } = useI18n()
  const { data: catalog, error } = useQuery<Catalog>('/api/v2/catalog')
  const [selected, setSelected] = useState(() => { const pending = Object.values(submissionStore.getSnapshot().submissions).find(item => item.path === `/api/v2/tasks/${task.id}/rerun`); return pending && typeof pending.body === 'string' ? JSON.parse(pending.body).workflowId as string : task.workflowId })
  const workflow = catalog?.workflows.find((item) => item.id === selected) ?? catalog?.workflows[0]
  return <Surface as="section" className="space-y-4 p-6">
    <h2 className="font-semibold">{tx("library.generate.again")}</h2>
    {error && <InlineAlert>{error}</InlineAlert>}
    {catalog && !workflow && <InlineAlert>{tx("library.no.workflows.are.available")}</InlineAlert>}
    {workflow && <><label className="grid gap-2 text-sm">{tx("library.workflow")}<NativeSelect disabled={locked} value={workflow.id} onChange={(event) => setSelected(event.target.value)} >{catalog!.workflows.map((item) => <option key={item.id} value={item.id}>{text(item.label, language)}</option>)}</NativeSelect></label><RerunForm submissionStore={submissionStore} request={request} navigate={navigate} useSlot={useSlot} key={`${workflow.id}:${workflow.version}`} task={task} workflow={workflow} close={close} onLockChange={onLockChange} /></>}
    {!workflow && <Button variant="outline" onClick={close}>{tx("library.close")}</Button>}
  </Surface>
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
  return <div className="space-y-4">
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
function Actions({ heading, submissionStore, task, refresh, prepareDelete, request, navigate, useQuery, useSlot }: PanelProps & { heading: (actions: ReactNode) => ReactNode; submissionStore: StudioDraftStore; prepareDelete(value: boolean): void } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot'>) {
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
  return <div className="space-y-4">{heading(<>{task.allowedActions.includes('cancel') && <Button size="sm" variant="outline" disabled={busy || rerunLocked} onClick={() => void act('cancel')}><Square />{tx("library.cancel.task")}</Button>}{task.allowedActions.includes('retry') && <Button size="sm" disabled={busy || rerunLocked} onClick={() => void act('retry')}><RotateCw />{tx("library.retry.from.start")}</Button>}{!task.graphSnapshot && task.allowedActions.includes('rerun') && <Button size="sm" variant="outline" disabled={busy || rerunLocked} onClick={() => setRerun(!rerun)}>{tx("library.generate.again")}</Button>}{task.allowedActions.includes('delete') && <Button size="sm" variant={confirmDelete ? 'destructive' : 'ghost'} disabled={busy || rerunLocked} onClick={() => { if (confirmDelete) void act('delete'); else { setConfirmDelete(true); prepareDelete(true) } }}><Trash2 />{confirmDelete ? tx("library.delete.task.and.files") : tx("library.delete.task")}</Button>}{confirmDelete && <Button size="sm" variant="ghost" onClick={() => { setConfirmDelete(false); prepareDelete(false) }}>{tx("library.keep.task")}</Button>}</>)}{task.mayStillRun && <InlineAlert tone="warning">{tx("library.the.remote.request.may.still.be.running")}</InlineAlert>}{error && <InlineAlert>{error}</InlineAlert>}{rerun && <RerunEditor submissionStore={submissionStore} request={request} navigate={navigate} useQuery={useQuery} useSlot={useSlot} task={task} close={() => setRerun(false)} locked={rerunLocked} onLockChange={setRerunLocked} />}</div>
}
export function TaskDetail({ submissionStore, params, request, navigate, useQuery, useSlot }: RouteProps & { submissionStore: StudioDraftStore } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot'>) {
  const tx = useText(), { language } = useI18n()
  const { data: task, error, refresh } = useQuery<TaskView>(`/api/v2/tasks/${encodeURIComponent(params.id)}`, 1500, taskNeedsPolling)
  const panels = useSlot('task.detail.panels'), actions = useSlot('task.detail.actions')
  const [mediaReleased, setMediaReleased] = useState(false), [showLog, setShowLog] = useState(false)
  const loadError = error && <div className="space-y-2"><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx("library.reload.task")}</Button></div>
  if (!task) return <Page>{loadError || <p role="status">{tx("library.loading")}</p>}</Page>
  const video = task.outputs.find((output) => output.mimeType?.startsWith('video/'))
  const completed = task.steps.filter((step) => step.status === 'completed').length
  const stepList = <ol className="space-y-4">{task.steps.map((step) => <li key={step.id} className="flex gap-3">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent">{step.status === 'completed' ? <Check className="size-4 text-status-success-fg" /> : step.status === 'running' ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4 text-muted-foreground" />}</span>
    <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2">{task.graphSnapshot ? <Link href={`/tasks/${task.id}/nodes/${step.id}`} className="text-sm font-medium text-link">{text(step.label, language)}</Link> : <span className="text-sm font-medium">{text(step.label, language)}</span>}<TaskState status={step.status} /></div>
      {step.progress != null && step.status === 'running' && <Progress label={`${text(step.label, language)} ${tx("library.progress")}`} value={step.progress} />}
      {step.message && <p className="mt-1 break-words text-xs text-muted-foreground">{taskProgressMessage(step.message, tx)}</p>}{step.error && <p className="mt-1 text-xs text-status-danger-fg">{step.error.message}</p>}
    </div>
  </li>)}</ol>
  return <Page>
    <Actions submissionStore={submissionStore} useQuery={useQuery} useSlot={useSlot} request={request} navigate={navigate} task={task} refresh={refresh} prepareDelete={setMediaReleased} heading={(actions) => <PageHeader title={taskDisplayName(task)} badge={<TaskState status={task.status} />} actions={actions} leading={<Button size="icon-sm" variant="ghost" aria-label={tx("library.library")} title={tx("library.library")} onClick={() => navigate('/tasks')}><ArrowLeft /></Button>}>
      <p className="mt-1 text-xs text-muted-foreground">{taskDisplayName(task) !== (task.graphSnapshot?.title || task.workflowId) && <>{task.graphSnapshot ? workflowTemplateTitle(task.graphSnapshot, tx) : task.workflowId} · </>}<time dateTime={task.createdAt}>{formatDateTime(task.createdAt)}</time></p>
    </PageHeader>} />
    {loadError}{task.error && <InlineAlert>{task.error.message}</InlineAlert>}
    {actions.map(({ id, component: Component }) => <Component key={id} task={task} refresh={refresh} />)}
    {video && !mediaReleased && <div className="overflow-hidden rounded-xl border border-border bg-black"><VideoPlayer src={video.url} /></div>}
    {!!task.outputs.length && <section className="space-y-4"><h2 className="font-semibold">{tx("library.generated.files")}</h2><Surface as="ol" className="m-0 list-none divide-y divide-border overflow-hidden p-0">{task.outputs.map((output) => {
      const label = output.label || output.name || output.id
      const displayLabel = task.graphSnapshot ? workflowPortLabel(task.graphSnapshot, { id: output.id, label }, tx) : label
      const audio = output.mimeType?.startsWith('audio/'), textual = output.mimeType?.startsWith('text/') || output.mimeType === 'application/x-subrip'
      const Icon = output.mimeType?.startsWith('video/') ? Film : audio ? AudioLines : textual ? Captions : FileText
      return <li key={output.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{displayLabel}</p>{output.size !== undefined && <p className="text-xs text-muted-foreground">{formatBytes(output.size)}</p>}</div>
        {!mediaReleased && audio && <AudioOutput src={output.url} className="order-last basis-full @2xl/page:order-none @2xl/page:basis-auto @2xl/page:w-80" />}
        {textual && <TextPreview path={`/api/v2/tasks/${encodeURIComponent(task.id)}/files/${encodeURIComponent(output.id)}`} url={output.url} title={displayLabel} useQuery={useQuery} />}
        <a href={output.url} download className="rounded-lg p-2 hover:bg-accent" aria-label={`${tx("library.download")} ${displayLabel}`}><Download className="size-4" /></a>
      </li>
    })}</Surface></section>}
    {panels.map(({ id, component: Component }) => <Component key={id} task={task} refresh={refresh} />)}
    {task.graphSnapshot ? <Disclosure contained={true} title={`${tx("library.step.list")} · ${completed}/${task.steps.length}`}><div className="mt-4">{stepList}</div></Disclosure> : <Surface as="section" className="p-4"><h2 className="mb-4 font-semibold">{tx("library.steps")} · {completed}/{task.steps.length}</h2>{stepList}</Surface>}
    <Disclosure onOpenChange={setShowLog} contained={true} title={tx("library.task.log")}>{showLog && <TaskLog useQuery={useQuery} active={taskNeedsPolling(task)} id={task.id} />}</Disclosure>
  </Page>
}
function AudioOutput({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  useReleaseMediaOnUnmount(ref, src)
  return <audio ref={ref} controls src={src} className={cn('h-10 w-full', className)} />
}
/** Subtitle files are served as downloads, so preview their text in place instead of opening the raw file. */
function TextPreview({ path, url, title, useQuery }: { path: string; url: string; title: string } & Bindings<'useQuery'>) {
  const tx = useText()
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>{tx("library.preview.text")}</Button>
    {open && <Modal open onClose={() => setOpen(false)} title={title} closeLabel={tx("library.close")} className="w-[min(40rem,100%)]"
      footer={<><a href={url} download className={cn(buttonVariants({ variant: 'outline' }), 'no-underline')}><Download />{tx("library.download")}</a><Button variant="outline" onClick={() => setOpen(false)}>{tx("library.close")}</Button></>}>
      <TextPreviewBody path={path} useQuery={useQuery} />
    </Modal>}
  </>
}
function TextPreviewBody({ path, useQuery }: { path: string } & Bindings<'useQuery'>) {
  const tx = useText()
  const { data, error, refresh } = useQuery<string>(path)
  if (error) return <div className="space-y-2"><InlineAlert>{error}</InlineAlert><Button size="sm" variant="outline" onClick={refresh}>{tx("library.reload.preview")}</Button></div>
  return <div className="max-h-[60dvh] min-h-24 overflow-auto rounded-lg bg-muted p-4 text-sm">{data == null ? <p role="status" className="text-muted-foreground">{tx("library.loading")}</p> : <SubtitleText content={data} />}</div>
}
function SubtitleText({ content }: { content: string }) {
  const cues = content.trim().split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/), timing = lines.findIndex((line) => line.includes('-->'))
    return timing === -1 || timing > 1 ? [] : [{ time: lines[timing].replace('-->', '→'), text: lines.slice(timing + 1).join('\n') }]
  })
  if (!cues.length) return <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{content}</pre>
  return <ol className="m-0 list-none space-y-3 p-0">{cues.map((cue, index) => <li key={index} className="grid gap-0.5"><span className="font-mono text-xs text-muted-foreground tabular-nums">{cue.time}</span><span className="break-words whitespace-pre-line">{cue.text}</span></li>)}</ol>
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
