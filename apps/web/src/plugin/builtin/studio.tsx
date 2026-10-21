import { bindComponent, type Bindings } from '../sdk'
import { Context } from 'cordis'
import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, ChevronRight, Link2, Loader2, Sparkles, X } from 'lucide-react'
import { Link, text, type Catalog, type JsonObject, type TaskPage, type TaskView, type WorkflowDescription } from '../sdk'
import { videoSource } from '@youdub/sdk/video-source'
import { Input } from '@/components/ui/input'
import { useI18n, useText } from '@/lib/i18n'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand/brand-mark'
import { TaskCover } from '@/components/task-cover'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ACTIVE_STATUSES, TaskProgress, TaskState, taskDisplayName } from './task-status'
import { ConfigEditor, defaultConfig, schemaProblems, useEditorSupported, validateConfig } from './schema-form'
import { GraphStudio } from './workflows'
import { UploadSlot } from './media-upload'


function Composer({ workflow, afterInputs, onLockChange, request, navigate, useSlot }: { workflow: WorkflowDescription; afterInputs?: ReactNode; onLockChange(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useSlot'>) {
  const tx = useText()
  const { language } = useI18n()
  const [config, setConfig] = useState<JsonObject>(() => structuredClone(workflow.defaults ?? defaultConfig(workflow.configSchema) ?? {}) as JsonObject)
  const [files, setFiles] = useState<Record<string, File>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [pendingId, setPendingId] = useState('')
  const [sourceUrl, setSourceUrl] = useState(''), [linkTouched, setLinkTouched] = useState(false)
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
    if (missing.length) { setError(`${tx('Check options:', '请检查选项：', 'オプションを確認：')}${missing.join(', ')}`); return }
    const id = pendingId || crypto.randomUUID()
    const body = new FormData()
    body.append('request', JSON.stringify({ id, workflowId: workflow.id, workflowVersion: workflow.version, config: taskConfig, ...(source ? { sourceName: source.url } : {}) }))
    for (const [name, file] of Object.entries(files)) body.append(`input.${name}`, file)
    setBusy(true); setError(''); setPendingId(id); onLockChange(true)
    try { const task = await request<TaskView>('/api/v2/tasks', { method: 'POST', body }); navigate(`/tasks/${task.id}`) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="relative">
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(55%_60%_at_30%_45%,rgb(251_114_153/0.16),transparent_70%),radial-gradient(50%_60%_at_75%_55%,rgb(0_174_236/0.16),transparent_70%)] opacity-70 blur-2xl dark:opacity-100" />
    <form onSubmit={(event) => void submit(event)} className="relative rounded-[28px] p-px before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgb(255_0_51/0.6),rgb(251_114_153/0.35)_42%,rgb(0_174_236/0.6))] before:opacity-45 before:transition-opacity before:duration-300 focus-within:before:opacity-100">
      <div className="relative rounded-[27px] bg-card p-2 shadow-float">
        {linkSlot && <div className="px-3 pt-3 pb-1">
          <div className="relative flex items-center gap-2 rounded-xl border border-input bg-muted px-3 focus-within:border-ring">
            <Link2 className="size-4 shrink-0 text-subtle-foreground" />
            <Input aria-label={tx('Video link', '视频链接', '動画リンク')} inputMode="url" autoComplete="off" value={sourceUrl} disabled={busy || !!pendingId} placeholder={tx('Paste a YouTube or Bilibili link', '粘贴 YouTube 或 B 站视频链接', 'YouTube / Bilibili のリンクを貼り付け')} className="h-12 min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" onBlur={() => setLinkTouched(true)} onChange={(event) => {
              setSourceUrl(event.target.value); setLinkTouched(false); setError('')
              if (event.target.value) setFiles((current) => { const next = { ...current }; delete next[linkSlot]; return next })
            }} />
            {source && <span className="shrink-0 text-xs text-muted-foreground">{source.platform === 'Bilibili' ? 'B 站' : 'YouTube'}</span>}
            {sourceUrl && <Button type="button" variant="ghost" size="icon-sm" disabled={busy || !!pendingId} aria-label={tx('Clear link', '清空链接', 'リンクをクリア')} onClick={() => { setSourceUrl(''); setLinkTouched(false) }}><X /></Button>}
          </div>
          {linkTouched && linkError && <div className="mt-2"><InlineAlert>{linkError}</InlineAlert></div>}
          <div className="my-4 flex items-center gap-3 text-xs text-subtle-foreground"><span className="h-px flex-1 bg-border" />{tx('or upload a video', '或上传本地视频', 'または動画をアップロード')}<span className="h-px flex-1 bg-border" /></div>
        </div>}
        <div className="grid gap-3">{workflow.inputs.map((slot) => <UploadSlot key={slot.name} slot={slot} alternative={slot.name === linkSlot} file={files[slot.name]} disabled={busy || !!pendingId} onChange={(file) => {
          if (file && slot.maxBytes && file.size > slot.maxBytes) {
            setError(`${text(slot.label, language)} ${tx('exceeds the file size limit', '超过文件大小限制', 'はファイルサイズの上限を超えています')}`)
            setFiles((current) => { const next = { ...current }; delete next[slot.name]; return next }); return
          }
          if (file && slot.name === linkSlot) { setSourceUrl(''); setLinkTouched(false) }
          setError(''); setFiles((current) => { const next = { ...current }; if (file) next[slot.name] = file; else delete next[slot.name]; return next })
        }} />)}</div>
        {afterInputs && <div className="px-3 pt-5 pb-2">{afterInputs}</div>}
        <div className={cn('flex flex-wrap items-center gap-3 px-2 pt-2.5 pb-1', workflow.inputs.length > 0 && 'mt-2 border-t border-border')}>
          <div className="min-w-0 flex-1"><ConfigEditor useSlot={useSlot} mode="options" ownerId={workflow.id} value={config} schema={workflow.configSchema} diagnostics={[]} readOnly={busy || !!pendingId} onChange={setConfig} /></div>
          <Button type="submit" size="xl" className="w-full shrink-0 sm:ml-auto sm:w-auto" disabled={busy || !supported || !requiredFiles || Boolean(linkError) || translationMissing}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{pendingId ? tx('Submit with the same ID', '使用同一 ID 提交', '同じ ID で送信') : source ? tx('Download and process', '下载并处理', 'ダウンロードして処理') : tx('Start processing', '开始处理', '処理を開始')}</Button>
        </div>
      </div>
    </form>
    {translationMissing && <div className="mt-4"><InlineAlert>{tx('Configure a translation connection and model before starting a task.', '开始任务前，请配置翻译连接和模型。', 'タスクを開始する前に翻訳の接続とモデルを設定してください。')} <Link href="/settings" className="underline underline-offset-4">{tx('Open settings', '打开设置', '設定を開く')}</Link></InlineAlert></div>}
    {(error || (pendingId && !busy)) && <div className="mt-4 space-y-3">
      {error && <InlineAlert>{error}</InlineAlert>}
      {pendingId && !busy && <div className="space-y-2 text-sm"><p className="break-all text-muted-foreground">{tx('Task ID:', '任务 ID：', 'タスク ID：')}{pendingId}</p><div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => { setBusy(true); void request<TaskView>(`/api/v2/tasks/${pendingId}`).then((task) => navigate(`/tasks/${task.id}`)).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Check task status', '查询创建结果', 'タスクの状態を確認')}</Button>
        <Button type="button" variant="outline" onClick={() => { setBusy(true); void request<void>(`/api/v2/imports/${pendingId}`, { method: 'DELETE' }).then(() => { setPendingId(''); setError(''); onLockChange(false) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Clear this import', '清理本次导入', '今回のインポートを削除')}</Button>
      </div></div>}
    </div>}
  </div>
}

function TaskSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const tx = useText()
  return <section aria-labelledby={id}><div className="mb-4 flex items-center justify-between gap-4"><h2 id={id} className="text-base font-semibold tracking-tight">{title}</h2><Link href="/tasks" className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">{tx('View all', '查看全部', 'すべて表示')}<ChevronRight className="size-4" /></Link></div>{children}</section>
}
function Studio({ request, navigate, useQuery, useSlot, useWorkflowDocuments, useWorkflowResources }: Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot' | 'useWorkflowDocuments' | 'useWorkflowResources'>) {
  const tx = useText()
  const { data: catalog, error, refresh } = useQuery<Catalog>('/api/v2/catalog')
  const { data: tasks, error: taskError, refresh: refreshTasks } = useQuery<TaskPage>('/api/v2/tasks?limit=12&offset=0', 3000)
  const { language, t } = useI18n()
  const [selected, setSelected] = useState(''), [locked, setLocked] = useState(false)
  const workflow = catalog?.workflows.find((item) => item.id === selected) ?? catalog?.workflows.find((item) => item.id === 'youdub.graph') ?? catalog?.workflows[0]
  const active = tasks?.items.filter((task) => ACTIVE_STATUSES.has(task.status)) ?? []
  const awaitingReview = active.flatMap((task) => task.steps.filter((step) => step.status === 'awaiting_review').map((step) => ({ task, step })))
  const processing = active.filter((task) => task.status !== 'paused')
  const recent = tasks?.items.filter((task) => !ACTIVE_STATUSES.has(task.status)).slice(0, 6) ?? []
  return <main>
    <section className="relative isolate flex min-h-[calc(100dvh-3.5rem)] flex-col justify-center overflow-hidden border-b border-border lg:min-h-dvh">
      <div aria-hidden="true" className="aurora -z-10" />
      <div aria-hidden="true" className="bg-dot-grid absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      <div className="mx-auto w-full max-w-4xl px-5 pt-10 pb-12 sm:px-8 lg:pt-14 lg:pb-14 [@media(max-height:820px)]:pt-8 [@media(max-height:820px)]:pb-10">
        <header className="flex animate-rise flex-col items-center text-center">
          <BrandMark animated className="h-10 sm:h-11 [@media(max-height:820px)]:h-9" />
          <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur [@media(max-height:820px)]:hidden"><Sparkles className="size-3.5 text-brand-pink" />{tx('AI translation · Dubbing · Subtitles', 'AI 视频翻译 · 配音 · 字幕', 'AI 動画翻訳 · 吹き替え · 字幕')}</span>
          <h1 className="mt-5 text-[34px] leading-[1.12] font-semibold tracking-tight text-balance sm:text-5xl lg:text-[52px] lg:[@media(max-height:820px)]:text-[44px]">{t.studio.heroTitleLead}{language === 'en' ? ' ' : ''}<span className="text-brand-gradient">{t.studio.heroTitleAccent}</span></h1>
        </header>
        <div className="mt-8 animate-rise [animation-delay:120ms] [@media(max-height:820px)]:mt-6">
          {error && <div className="mb-5 space-y-2"><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx('Reload', '重新加载', '再読み込み')}</Button></div>}
          {!catalog && !error && <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx('Loading…', '正在加载…', '読み込み中…')}</p>}
          {catalog && !workflow && <InlineAlert>{tx('No workflows are available.', '当前没有可用流程。', '利用可能なワークフローがありません。')}</InlineAlert>}
          {workflow && (workflow.id === 'youdub.graph' ? <GraphStudio useWorkflowResources={useWorkflowResources} request={request} navigate={navigate} useQuery={useQuery} useSlot={useSlot} useWorkflowDocuments={useWorkflowDocuments} onLockChange={setLocked}
            additionalWorkflows={catalog!.workflows.filter((item) => item.id !== 'youdub.graph' && item.id !== 'youdub.localize')}
            renderWorkflow={(item, selector, lockChanged) => <Composer request={request} navigate={navigate} useSlot={useSlot} key={`${item.id}:${item.version}`} workflow={item} afterInputs={selector} onLockChange={lockChanged} />}
          /> : <Composer request={request} navigate={navigate} useSlot={useSlot} key={`${workflow.id}:${workflow.version}`} workflow={workflow} onLockChange={setLocked} afterInputs={catalog!.workflows.length > 1 ? <div className="flex items-center gap-3"><Label htmlFor="workflow">{tx('Workflow', '工作流', 'ワークフロー')}</Label><select id="workflow" disabled={locked} value={workflow.id} onChange={(event) => setSelected(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-sm">{catalog!.workflows.map((item) => <option key={item.id} value={item.id}>{text(item.label, language)}</option>)}</select></div> : undefined} />)}
        </div>
        <div className="mt-5 flex justify-center"><a href="/examples/index.html" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{tx('View built-in examples', '查看内置示例', '内蔵サンプルを見る')}</a></div>
        {!!active.length && <div className="mt-6 flex flex-wrap justify-center gap-3">
          {!!awaitingReview.length && <Link href={awaitingReview.length === 1 ? `/tasks/${awaitingReview[0].task.id}/nodes/${awaitingReview[0].step.id}` : '/tasks'} className="inline-flex items-center gap-2 rounded-full border border-status-warning/25 bg-status-warning/10 px-3.5 py-1.5 text-[13px] font-medium text-status-warning-fg">{tx(`${awaitingReview.length} nodes need your review`, `${awaitingReview.length} 个节点待确认`, `${awaitingReview.length} 件のノードが確認待ち`)}<ArrowRight className="size-3.5" /></Link>}
          {!!processing.length && <Link href="/tasks" className="inline-flex items-center gap-2 rounded-full border border-status-running/25 bg-status-running/10 px-3.5 py-1.5 text-[13px] font-medium text-status-running-fg">{tx(`${processing.length} tasks in progress`, `${processing.length} 个任务正在处理`, `${processing.length} 件のタスクが処理中`)}<ArrowRight className="size-3.5" /></Link>}
        </div>}
      </div>
    </section>
    <div className="mx-auto max-w-6xl space-y-12 px-5 py-10 sm:px-8 lg:py-14">
      {taskError && <div className="space-y-2"><InlineAlert>{taskError}</InlineAlert><Button variant="outline" onClick={refreshTasks}>{tx('Reload tasks', '重新加载任务', 'タスクを再読み込み')}</Button></div>}
      {active.length > 0 && <TaskSection id="studio-active" title={tx('In progress', '进行中', '処理中')}><div className="grid gap-3 lg:grid-cols-2">{active.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-3 pr-4 shadow-card transition-[border-color,transform] outline-none hover:-translate-y-px hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40"><TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="sm" className="w-24 sm:w-28" /><div className="min-w-0 flex-1 space-y-2"><div className="flex items-start justify-between gap-3"><p title={taskDisplayName(task)} className="line-clamp-2 min-w-0 text-sm font-medium break-words">{taskDisplayName(task)}</p><TaskState status={task.status} /></div><TaskProgress task={task} /></div></Link>)}</div></TaskSection>}
      <TaskSection id="studio-recent" title={tx('Recent tasks', '最近任务', '最近のタスク')}>
        {!tasks && !taskError ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="overflow-hidden rounded-2xl border border-border bg-card"><div className="aspect-video animate-pulse bg-accent" /><div className="space-y-2.5 p-4"><div className="h-4 w-4/5 animate-pulse rounded-md bg-accent" /><div className="h-3 w-2/5 animate-pulse rounded-md bg-accent" /></div></div>)}</div>
          : tasks && recent.length === 0 ? <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted px-6 py-14 text-center"><BrandMark className="h-8 opacity-60 grayscale" /><p className="mt-5 text-sm font-medium">{tx('No finished tasks yet', '还没有完成的任务', '完了したタスクはまだありません')}</p></div>
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recent.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-[border-color,box-shadow,transform] outline-none hover:-translate-y-0.5 hover:border-input hover:shadow-float focus-visible:ring-3 focus-visible:ring-ring/40"><TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="md" className="rounded-none ring-0" /><div className="flex flex-1 flex-col gap-3 p-4"><p title={taskDisplayName(task)} className="line-clamp-2 text-sm leading-snug font-medium break-words">{taskDisplayName(task)}</p><div className="mt-auto flex items-center justify-between gap-3"><TaskState status={task.status} /><time className="text-xs text-muted-foreground" dateTime={task.createdAt}>{formatDateTime(task.createdAt)}</time></div></div></Link>)}</div>}
      </TaskSection>
    </div>
  </main>
}
export const name = 'client-studio'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'studio', path: '/', component: bindComponent(ctx, ['request', 'navigate', 'useQuery', 'useSlot', 'useWorkflowDocuments', 'useWorkflowResources'], Studio), access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'studio', routeId: 'studio', label: { default: 'Studio', translations: { zh: '工作台', ja: 'スタジオ' } }, order: 10, icon: Sparkles }))
}
