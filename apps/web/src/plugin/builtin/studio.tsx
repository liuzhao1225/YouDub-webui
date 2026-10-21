import { NativeSelect } from '@/components/ui/native-select'
import { bindComponent, type Bindings } from '../sdk'
import { Context } from 'cordis'
import { useEffect, useState, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import { ArrowRight, ChevronRight, Link2, Loader2, Sparkles, X } from 'lucide-react'
import { Link, text, type Catalog, type JsonObject, type TaskPage, type TaskView, type WorkflowDescription } from '../sdk'
import { videoSource } from '@youdub/sdk/video-source'
import { Input } from '@/components/ui/input'
import { useI18n, useText } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand/brand-mark'
import { TaskCover } from '@/components/task-cover'
import { PageContainer } from '@/components/page-layout'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ACTIVE_STATUSES, TaskProgress, TaskState, taskDisplayName } from './task-status'
import { ConfigEditor, defaultConfig, schemaProblems, useEditorSupported, validateConfig } from './schema-form'
import { protectPendingSubmissions, useActiveView, useObservableSource, usePendingUnload } from '../view-hooks'
import { StudioDraftStore, type ComposerDraft } from '@/runtime/studio-draft'
import { GraphStudio } from './workflows'
import { UploadSlot } from './media-upload'


function Composer({ workflow, draftStore, afterInputs, onLockChange, request, navigate, useSlot }: { workflow: WorkflowDescription; draftStore: StudioDraftStore; afterInputs?: ReactNode; onLockChange(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useSlot'>) {
  const tx = useText()
  const { language } = useI18n()
  const draftKey = `${workflow.id}:${workflow.version}`
  const { composers, submissions } = useObservableSource(draftStore)
  const submissionKey = `composer:${draftKey}`
  const submission = submissions[submissionKey]
  const activeView = useActiveView()
  const [initialDraft] = useState<ComposerDraft>(() => ({ files: {}, sourceUrl: '', config: structuredClone(workflow.defaults ?? defaultConfig(workflow.configSchema) ?? {}) as JsonObject }))
  const { config, files, sourceUrl } = composers[draftKey] ?? initialDraft
  const updateDraft = (change: (current: ComposerDraft) => ComposerDraft) => draftStore.set('composers', current => ({ ...current, [draftKey]: change(current[draftKey] ?? initialDraft) }))
  const setConfig = (config: JsonObject) => updateDraft(current => ({ ...current, config }))
  const setFiles = (files: SetStateAction<Record<string, File>>) => updateDraft(current => ({ ...current, files: typeof files === 'function' ? files(current.files) : files }))
  const setSourceUrl = (sourceUrl: string) => updateDraft(current => ({ ...current, sourceUrl }))
  const [localError, setError] = useState('')
  const error = submission?.error || localError, busy = submission?.busy ?? false, pendingId = submission?.id ?? ''
  usePendingUnload(!!pendingId)
  useEffect(() => { onLockChange(busy || !!pendingId) }, [busy, pendingId, onLockChange])
  const [linkTouched, setLinkTouched] = useState(false)
  function openTask(task: TaskView) {
    if (!activeView.current) return
    draftStore.clearSubmission(submissionKey)
    draftStore.set('composers', current => { const next = { ...current }; delete next[draftKey]; return next })
    navigate(`/tasks/${task.id}`)
  }
  const linkSlot = workflow.ui?.sourceUrlInput
  let source: ReturnType<typeof videoSource> | undefined, linkError = ''
  if (sourceUrl.trim()) {
    try { source = videoSource(sourceUrl) }
    catch (failure) { linkError = failure instanceof Error ? failure.message : String(failure) }
  }
  const supported = useEditorSupported(useSlot, workflow.id, workflow.configSchema)
  const requiredFiles = workflow.inputs.filter((slot) => slot.required || slot.name === linkSlot).every((slot) => Boolean(files[slot.name]) || (slot.name === linkSlot && Boolean(source)))
  const taskConfig = { ...config, ...(source ? { source_url: source.url } : {}) }
  const translation = config.translation as JsonObject | null | undefined
  const translationMissing = workflow.id === 'youdub.localize' && (!translation || typeof translation !== 'object' || Array.isArray(translation) || !translation.adapter || !translation.model || !translation.device)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !supported || !requiredFiles || linkError || translationMissing) return
    const missing = schemaProblems(workflow.configSchema).length ? [] : validateConfig(workflow.configSchema, taskConfig)
    if (missing.length) { setError(`${tx("studio.check.options")}${missing.join(', ')}`); return }
    const id = pendingId || crypto.randomUUID()
    const body = new FormData()
    body.append('request', JSON.stringify({ id, workflowId: workflow.id, workflowVersion: workflow.version, config: taskConfig, ...(source ? { sourceName: source.url } : {}) }))
    for (const [name, file] of Object.entries(files)) body.append(`input.${name}`, file)
    setError('')
    const task = await draftStore.submit(submissionKey, request, body)
    if (task) openTask(task)
  }
  return <div className="relative">
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(55%_60%_at_30%_45%,rgb(251_114_153/0.16),transparent_70%),radial-gradient(50%_60%_at_75%_55%,rgb(0_174_236/0.16),transparent_70%)] opacity-70 blur-2xl dark:opacity-100" />
    <form onSubmit={(event) => void submit(event)} className="relative rounded-[28px] p-px before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgb(255_0_51/0.6),rgb(251_114_153/0.35)_42%,rgb(0_174_236/0.6))] before:opacity-45 before:transition-opacity before:duration-300 focus-within:before:opacity-100">
      <div className="relative rounded-[27px] bg-card p-2 shadow-float">
        {linkSlot && <div className="px-3 pt-3 pb-1">
          <div className="relative flex items-center gap-2 rounded-xl border border-input bg-muted px-3 focus-within:border-ring">
            <Link2 className="size-4 shrink-0 text-subtle-foreground" />
            <Input aria-label={tx("studio.video.link")} inputMode="url" autoComplete="off" value={sourceUrl} disabled={busy || !!pendingId} placeholder={tx("studio.paste.a.youtube.or.bilibili.link")} className="h-12 min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" onBlur={() => setLinkTouched(true)} onChange={(event) => {
              setSourceUrl(event.target.value); setLinkTouched(false); setError('')
              if (event.target.value) setFiles((current) => { const next = { ...current }; delete next[linkSlot]; return next })
            }} />
            {source && <span className="shrink-0 text-xs text-muted-foreground">{source.platform === 'Bilibili' ? 'B 站' : 'YouTube'}</span>}
            {sourceUrl && <Button type="button" variant="ghost" size="icon-sm" disabled={busy || !!pendingId} aria-label={tx("studio.clear.link")} onClick={() => { setSourceUrl(''); setLinkTouched(false) }}><X /></Button>}
          </div>
          {linkTouched && linkError && <div className="mt-2"><InlineAlert>{linkError}</InlineAlert></div>}
          {source && workflow.configSchema.properties?.source_proxy_port && <div className="mt-3"><ConfigEditor useSlot={useSlot} ownerId="video-link.download" schema={{ type: 'object', properties: { source_proxy_port: workflow.configSchema.properties.source_proxy_port } }} value={{ source_proxy_port: config.source_proxy_port ?? 0 }} diagnostics={[]} readOnly={busy || !!pendingId} onChange={(value) => setConfig({ ...config, source_proxy_port: value.source_proxy_port })} /></div>}
          <div className="my-4 flex items-center gap-3 text-xs text-subtle-foreground"><span className="h-px flex-1 bg-border" />{tx("studio.or.upload.a.video")}<span className="h-px flex-1 bg-border" /></div>
        </div>}
        <div className="grid gap-3">{workflow.inputs.map((slot) => <UploadSlot key={slot.name} slot={slot} alternative={slot.name === linkSlot} file={files[slot.name]} disabled={busy || !!pendingId} onChange={(file) => {
          if (file && slot.maxBytes && file.size > slot.maxBytes) {
            setError(`${text(slot.label, language)} ${tx("studio.exceeds.the.file.size.limit")}`)
            setFiles((current) => { const next = { ...current }; delete next[slot.name]; return next }); return
          }
          if (file && slot.name === linkSlot) { setSourceUrl(''); setLinkTouched(false) }
          setError(''); setFiles((current) => { const next = { ...current }; if (file) next[slot.name] = file; else delete next[slot.name]; return next })
        }} />)}</div>
        {afterInputs && <div className="px-3 pt-5 pb-2">{afterInputs}</div>}
        <div className={cn('flex flex-wrap items-center gap-3 px-2 pt-2.5 pb-1', workflow.inputs.length > 0 && 'mt-2 border-t border-border')}>
          <div className="min-w-0 flex-1"><ConfigEditor useSlot={useSlot} mode="options" ownerId={workflow.id} value={config} schema={workflow.configSchema} diagnostics={[]} readOnly={busy || !!pendingId} onChange={setConfig} /></div>
          <Button type="submit" size="xl" className="w-full shrink-0 sm:ml-auto sm:w-auto" disabled={busy || !supported || !requiredFiles || Boolean(linkError) || translationMissing}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{pendingId ? tx("studio.submit.with.the.same.id") : source ? tx("studio.download.and.process") : tx("studio.start.processing")}</Button>
        </div>
      </div>
    </form>
    {translationMissing && <div className="mt-4"><InlineAlert>{tx("studio.configure.a.translation.connection.and.model.before.starting.a.ta")} <Link href="/settings/models" className="underline underline-offset-4">{tx("studio.open.settings")}</Link></InlineAlert></div>}
    {(error || (pendingId && !busy)) && <div className="mt-4 space-y-3">
      {error && <InlineAlert>{error}</InlineAlert>}
      {pendingId && !busy && <div className="space-y-2 text-sm"><p className="break-all text-muted-foreground">{tx("studio.task.id")}{pendingId}</p><div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => { void draftStore.check(submissionKey, request).then(task => { if (task) openTask(task) }) }}>{tx("studio.check.task.status")}</Button>
        <Button type="button" variant="outline" onClick={() => { void draftStore.discard(submissionKey, request).then(cleared => { if (cleared && activeView.current) setError('') }) }}>{tx("studio.clear.this.import")}</Button>
      </div></div>}
    </div>}
  </div>
}

function TaskSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const tx = useText()
  return <section aria-labelledby={id}><div className="mb-4 flex items-center justify-between gap-4"><h2 id={id} className="text-base font-semibold tracking-tight">{title}</h2><Link href="/tasks" className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">{tx("studio.view.all")}<ChevronRight className="size-4" /></Link></div>{children}</section>
}
export function Studio({ draftStore, request, navigate, useQuery, useSlot, useWorkflowDocuments, useWorkflowResources, examplesLink }: { draftStore: StudioDraftStore; examplesLink?: ReactNode } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot' | 'useWorkflowDocuments' | 'useWorkflowResources'>) {
  const tx = useText()
  const { data: catalog, error, refresh } = useQuery<Catalog>('/api/v2/catalog')
  const { data: tasks, error: taskError, refresh: refreshTasks } = useQuery<TaskPage>('/api/v2/tasks?limit=12&offset=0', 3000)
  const { language, t } = useI18n()
  const { selected } = useObservableSource(draftStore)
  const setSelected = (id: string) => draftStore.set('selected', `workflow:${id}`)
  const [locked, setLocked] = useState(false)
  const workflow = catalog?.workflows.find((item) => item.id === 'youdub.graph') ?? catalog?.workflows.find((item) => `workflow:${item.id}` === selected) ?? catalog?.workflows[0]
  const active = tasks?.items.filter((task) => ACTIVE_STATUSES.has(task.status)) ?? []
  const awaitingReview = active.flatMap((task) => task.steps.filter((step) => step.status === 'awaiting_review').map((step) => ({ task, step })))
  const processing = active.filter((task) => task.status !== 'paused')
  const recent = tasks?.items.filter((task) => !ACTIVE_STATUSES.has(task.status)).slice(0, 6) ?? []
  return <main>
    <section className="relative isolate flex min-h-[calc(100dvh-var(--dsh-frame-top-clearance,3.5rem))] flex-col justify-center overflow-hidden border-b border-border lg:min-h-[calc(100dvh-var(--dsh-frame-top-clearance,0px))]">
      <div aria-hidden="true" className="aurora -z-10" />
      <div aria-hidden="true" className="bg-dot-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      <PageContainer className="pt-10 pb-12 lg:pt-14 lg:pb-14 [@media(max-height:820px)]:pt-8 [@media(max-height:820px)]:pb-10">
        <header className="flex animate-rise flex-col items-center text-center">
          <BrandMark animated className="h-10 sm:h-11 [@media(max-height:820px)]:h-9" />
          <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur [@media(max-height:820px)]:hidden"><Sparkles className="size-3.5 text-brand-pink" />{tx("studio.ai.translation.dubbing.subtitles")}</span>
          <h1 className="mt-5 text-[34px] leading-[1.12] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[52px] lg:[@media(max-height:820px)]:text-[44px]">{t.studio.heroTitleLead}{language === 'en' ? ' ' : ''}<span className="text-brand-gradient">{t.studio.heroTitleAccent}</span></h1>
        </header>
        <div className="mt-8 animate-rise [animation-delay:120ms] [@media(max-height:820px)]:mt-6">
          {error && <div className="mb-5 space-y-2"><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx("studio.reload")}</Button></div>}
          {!catalog && !error && <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx("studio.loading")}</p>}
          {catalog && !workflow && <InlineAlert>{tx("studio.no.workflows.are.available")}</InlineAlert>}
          {workflow && (workflow.id === 'youdub.graph' ? <GraphStudio draftStore={draftStore} useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useQuery={useQuery} useSlot={useSlot} useWorkflowDocuments={useWorkflowDocuments} onLockChange={setLocked}
            additionalWorkflows={catalog!.workflows.filter((item) => item.id !== 'youdub.graph' && item.id !== 'youdub.localize')}
            renderWorkflow={(item, selector, lockChanged) => <Composer request={request} navigate={navigate} useSlot={useSlot} draftStore={draftStore} key={`${item.id}:${item.version}`} workflow={item} afterInputs={selector} onLockChange={lockChanged} />}
          /> : <Composer request={request} navigate={navigate} useSlot={useSlot} draftStore={draftStore} key={`${workflow.id}:${workflow.version}`} workflow={workflow} onLockChange={setLocked} afterInputs={catalog!.workflows.length > 1 ? <div className="flex items-center gap-3"><Label htmlFor="workflow">{tx("studio.workflow")}</Label><NativeSelect id="workflow" disabled={locked} value={workflow.id} onChange={(event) => setSelected(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-sm">{catalog!.workflows.map((item) => <option key={item.id} value={item.id}>{text(item.label, language)}</option>)}</NativeSelect></div> : undefined} />)}
        </div>
        <div className="mt-5 flex justify-center">{examplesLink ?? <a href="/examples/index.html" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{tx("studio.view.built.in.examples")}</a>}</div>
        {!!active.length && <div className="mt-6 flex flex-wrap justify-center gap-3">
          {!!awaitingReview.length && <Link href={awaitingReview.length === 1 ? `/tasks/${awaitingReview[0].task.id}/nodes/${awaitingReview[0].step.id}` : '/tasks'} className="inline-flex items-center gap-2 rounded-full border border-status-warning/25 bg-status-warning/10 px-3.5 py-1.5 text-[13px] font-medium text-status-warning-fg">{tx("studio.value.nodes.need.your.review", { value1: awaitingReview.length })}<ArrowRight className="size-3.5" /></Link>}
          {!!processing.length && <Link href="/tasks" className="inline-flex items-center gap-2 rounded-full border border-status-running/25 bg-status-running/10 px-3.5 py-1.5 text-[13px] font-medium text-status-running-fg">{tx("studio.value.tasks.in.progress", { value1: processing.length })}<ArrowRight className="size-3.5" /></Link>}
        </div>}
      </PageContainer>
    </section>
    <PageContainer className="space-y-12 py-10 lg:py-14">
      {taskError && <div className="space-y-2"><InlineAlert>{taskError}</InlineAlert><Button variant="outline" onClick={refreshTasks}>{tx("studio.reload.tasks")}</Button></div>}
      {active.length > 0 && <TaskSection id="studio-active" title={tx("studio.in.progress")}><div className="grid gap-3 lg:grid-cols-2">{active.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-3 pr-4 shadow-card transition-[border-color,transform] outline-none hover:-translate-y-px hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40"><TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="sm" className="w-24 sm:w-28" /><div className="min-w-0 flex-1 space-y-2"><div className="flex items-start justify-between gap-3"><p title={taskDisplayName(task)} className="line-clamp-2 min-w-0 text-sm font-medium break-words">{taskDisplayName(task)}</p><TaskState status={task.status} /></div><TaskProgress task={task} /></div></Link>)}</div></TaskSection>}
      <TaskSection id="studio-recent" title={tx("studio.recent.tasks")}>
        {!tasks && !taskError ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="overflow-hidden rounded-2xl border border-border bg-card"><div className="aspect-video animate-pulse bg-accent" /><div className="space-y-2.5 p-4"><div className="h-4 w-4/5 animate-pulse rounded-md bg-accent" /><div className="h-3 w-2/5 animate-pulse rounded-md bg-accent" /></div></div>)}</div>
          : tasks && recent.length === 0 ? <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted px-6 py-14 text-center"><BrandMark className="h-8 opacity-60 grayscale" /><p className="mt-5 text-sm font-medium">{tx("studio.no.finished.tasks.yet")}</p></div>
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recent.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-[border-color,box-shadow,transform] outline-none hover:-translate-y-0.5 hover:border-input hover:shadow-float focus-visible:ring-3 focus-visible:ring-ring/40"><TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="md" className="rounded-none ring-0" /><div className="flex flex-1 flex-col gap-3 p-4"><p title={taskDisplayName(task)} className="line-clamp-2 text-sm leading-snug font-medium break-words">{taskDisplayName(task)}</p><div className="mt-auto flex items-center justify-between gap-3"><TaskState status={task.status} /><time className="text-xs text-muted-foreground" dateTime={task.createdAt}>{formatDateTime(task.createdAt)}</time></div></div></Link>)}</div>}
      </TaskSection>
    </PageContainer>
  </main>
}
export const name = 'client-studio'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  const draftStore = new StudioDraftStore()
  ctx.effect(() => () => draftStore.reset())
  protectPendingSubmissions(ctx, draftStore)
  const BoundStudio = bindComponent(ctx, ['request', 'navigate', 'useQuery', 'useSlot', 'useWorkflowDocuments', 'useWorkflowResources'], Studio)
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'studio', path: '/', component: () => <BoundStudio draftStore={draftStore} />, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'studio', routeId: 'studio', label: { default: 'Studio', translations: { zh: '工作台', ja: 'スタジオ' } }, order: 10, icon: Sparkles }))
}
