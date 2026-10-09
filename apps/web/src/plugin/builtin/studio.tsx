import { Context } from 'cordis'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, ChevronRight, FileText, Film, Loader2, Sparkles, Upload, X } from 'lucide-react'
import { Link, text, useClient, type Catalog, type InputSlot, type JsonObject, type TaskPage, type TaskView, type WorkflowDescription } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { formatBytes, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { BrandMark } from '@/components/brand/brand-mark'
import { TaskCover } from '@/components/task-cover'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useQuery } from './use-query'
import { ACTIVE_STATUSES, TaskProgress, TaskState } from './task-status'
import { ConfigEditor, defaultConfig, schemaProblems, useEditorSupported, validateConfig } from './schema-form'

function UploadSlot({ slot, file, disabled, onChange }: { slot: InputSlot; file?: File; disabled: boolean; onChange(file?: File): void }) {
  const tx = useText()
  const { language } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const video = slot.acceptedMimeTypes.some((mime) => mime.startsWith('video/'))
  const Icon = video ? Film : FileText
  return <div>
    <label htmlFor={`input-${slot.name}`} className="sr-only">{text(slot.label, language)}{slot.required ? ' *' : ''}</label>
    <div onDragEnter={() => { if (!disabled) setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={() => setDragActive(false)} className={cn(
      'relative flex min-h-[132px] items-center justify-center rounded-[20px] border border-dashed px-5 py-6 transition-colors',
      'has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/25',
      dragActive ? 'border-brand-blue bg-secondary' : file ? 'border-border bg-muted' : 'border-input bg-muted hover:border-subtle-foreground/60 hover:bg-accent',
      disabled && 'opacity-60',
    )}>
      <input ref={input} id={`input-${slot.name}`} type="file" disabled={disabled} required={slot.required} accept={slot.acceptedMimeTypes.join(',')} className="absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed" onChange={(event) => { setDragActive(false); const file = event.target.files?.[0]; if (file && slot.maxBytes && file.size > slot.maxBytes) event.target.value = ''; onChange(file) }} />
      {file ? <div className="flex w-full items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgb(251_114_153/0.25),rgb(0_174_236/0.25))] text-foreground ring-1 ring-border ring-inset"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1"><p className="truncate text-[15px] font-medium">{file.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)} · {tx('Click or drop to replace', '点击或拖入以替换', 'クリックまたはドロップで差し替え')}</p></div>
        <Button type="button" variant="ghost" size="icon-sm" className="relative z-20" disabled={disabled} aria-label={`${tx('Remove', '移除', '削除')} ${file.name}`} onClick={() => { if (input.current) input.current.value = ''; onChange(undefined) }}><X /></Button>
      </div> : <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-card shadow-card ring-1 ring-border"><Upload className="size-5 text-brand-blue" /></span>
        <p className="text-[15px] font-medium">{video ? tx('Drop a video here, or click to choose', '拖入视频，或点击选择文件', '動画をドロップ、またはクリックして選択') : tx('Drop a file here, or click to choose', '拖入文件，或点击选择', 'ファイルをドロップ、またはクリックして選択')}</p>
        <p className="text-xs text-subtle-foreground">{text(slot.label, language)}{slot.required ? '' : ` · ${tx('Optional', '可选', '任意')}`}{slot.maxBytes ? ` · ${tx('Up to', '最大', '上限')} ${formatBytes(slot.maxBytes)}` : ''}</p>
      </div>}
    </div>
  </div>
}

function Composer({ workflow, onLockChange }: { workflow: WorkflowDescription; onLockChange(locked: boolean): void }) {
  const tx = useText()
  const { apiClient, navigation } = useClient()
  const { language } = useI18n()
  const [config, setConfig] = useState<JsonObject>(() => structuredClone(workflow.defaults ?? defaultConfig(workflow.configSchema) ?? {}) as JsonObject)
  const [files, setFiles] = useState<Record<string, File>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [pendingId, setPendingId] = useState('')
  const supported = useEditorSupported(workflow.id, workflow.configSchema)
  const requiredFiles = workflow.inputs.filter((slot) => slot.required).every((slot) => Boolean(files[slot.name]))
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || !supported || !requiredFiles) return
    const missing = schemaProblems(workflow.configSchema).length ? [] : validateConfig(workflow.configSchema, config)
    if (missing.length) { setError(`${tx('Check options:', '请检查选项：', 'オプションを確認：')}${missing.join(', ')}`); return }
    const id = pendingId || crypto.randomUUID()
    const body = new FormData()
    body.append('request', JSON.stringify({ id, workflowId: workflow.id, workflowVersion: workflow.version, config }))
    for (const [name, file] of Object.entries(files)) body.append(`input.${name}`, file)
    setBusy(true); setError(''); setPendingId(id); onLockChange(true)
    try { const task = await apiClient.request<TaskView>('/api/v2/tasks', { method: 'POST', body }); navigation.push(`/tasks/${task.id}`) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="relative">
    <div aria-hidden="true" className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 bg-[radial-gradient(55%_60%_at_30%_45%,rgb(251_114_153/0.16),transparent_70%),radial-gradient(50%_60%_at_75%_55%,rgb(0_174_236/0.16),transparent_70%)] opacity-70 blur-2xl dark:opacity-100" />
    <form onSubmit={(event) => void submit(event)} className="relative rounded-[28px] p-px before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgb(255_0_51/0.6),rgb(251_114_153/0.35)_42%,rgb(0_174_236/0.6))] before:opacity-45 before:transition-opacity before:duration-300 focus-within:before:opacity-100">
      <div className="relative rounded-[27px] bg-card p-2 shadow-float">
        <div className="grid gap-3">{workflow.inputs.map((slot) => <UploadSlot key={slot.name} slot={slot} file={files[slot.name]} disabled={busy || !!pendingId} onChange={(file) => {
          if (file && slot.maxBytes && file.size > slot.maxBytes) {
            setError(`${text(slot.label, language)} ${tx('exceeds the file size limit', '超过文件大小限制', 'はファイルサイズの上限を超えています')}`)
            setFiles((current) => { const next = { ...current }; delete next[slot.name]; return next }); return
          }
          setError(''); setFiles((current) => { const next = { ...current }; if (file) next[slot.name] = file; else delete next[slot.name]; return next })
        }} />)}</div>
        <div className={cn('flex flex-wrap items-center gap-3 px-2 pt-2.5 pb-1', workflow.inputs.length > 0 && 'mt-2 border-t border-border')}>
          <div className="min-w-0 flex-1"><ConfigEditor mode="options" ownerId={workflow.id} value={config} schema={workflow.configSchema} diagnostics={[]} readOnly={busy || !!pendingId} onChange={setConfig} /></div>
          <Button type="submit" size="xl" className="w-full shrink-0 sm:ml-auto sm:w-auto" disabled={busy || !supported || !requiredFiles}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{pendingId ? tx('Submit with the same ID', '使用同一 ID 提交', '同じ ID で送信') : tx('Start processing', '开始处理', '処理を開始')}</Button>
        </div>
      </div>
    </form>
    {(error || (pendingId && !busy)) && <div className="mt-4 space-y-3">
      {error && <InlineAlert>{error}</InlineAlert>}
      {pendingId && !busy && <div className="space-y-2 text-sm"><p className="break-all text-muted-foreground">{tx('Task ID:', '任务 ID：', 'タスク ID：')}{pendingId}</p><div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => { setBusy(true); void apiClient.request<TaskView>(`/api/v2/tasks/${pendingId}`).then((task) => navigation.push(`/tasks/${task.id}`)).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Check task status', '查询创建结果', 'タスクの状態を確認')}</Button>
        <Button type="button" variant="outline" onClick={() => { setBusy(true); void apiClient.request<void>(`/api/v2/imports/${pendingId}`, { method: 'DELETE' }).then(() => { setPendingId(''); setError(''); onLockChange(false) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Clear this import', '清理本次导入', '今回のインポートを削除')}</Button>
      </div></div>}
    </div>}
  </div>
}

function TaskSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const tx = useText()
  return <section aria-labelledby={id}><div className="mb-4 flex items-center justify-between gap-4"><h2 id={id} className="text-base font-semibold tracking-tight">{title}</h2><Link href="/tasks" className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground">{tx('View all', '查看全部', 'すべて表示')}<ChevronRight className="size-4" /></Link></div>{children}</section>
}
function Studio() {
  const tx = useText()
  const { data: catalog, error, refresh } = useQuery<Catalog>('/api/v2/catalog')
  const { data: tasks, error: taskError, refresh: refreshTasks } = useQuery<TaskPage>('/api/v2/tasks?limit=12&offset=0', 3000)
  const { language, t } = useI18n()
  const [selected, setSelected] = useState(''), [locked, setLocked] = useState(false)
  const workflow = catalog?.workflows.find((item) => item.id === selected) ?? catalog?.workflows[0]
  const active = tasks?.items.filter((task) => ACTIVE_STATUSES.has(task.status)) ?? []
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
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-pretty text-muted-foreground sm:text-[17px] [@media(max-height:820px)]:mt-3">{t.studio.heroSubtitle}</p>
        </header>
        <div className="mt-8 animate-rise [animation-delay:120ms] [@media(max-height:820px)]:mt-6">
          {error && <div className="mb-5 space-y-2"><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx('Reload', '重新加载', '再読み込み')}</Button></div>}
          {!catalog && !error && <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx('Loading…', '正在加载…', '読み込み中…')}</p>}
          {catalog && !workflow && <InlineAlert>{tx('No workflows are available.', '当前没有可用流程。', '利用可能なワークフローがありません。')}</InlineAlert>}
          {workflow && <>
            {catalog!.workflows.length > 1 && <div className="mb-4 flex items-center gap-3"><Label htmlFor="workflow">{tx('Workflow', '处理流程', 'ワークフロー')}</Label><select id="workflow" disabled={locked} value={workflow.id} onChange={(event) => setSelected(event.target.value)} className="h-9 min-w-0 rounded-full border border-input bg-card px-3 text-sm">{catalog!.workflows.map((item) => <option key={item.id} value={item.id}>{text(item.label, language)}</option>)}</select></div>}
            <Composer key={`${workflow.id}:${workflow.version}`} workflow={workflow} onLockChange={setLocked} />
          </>}
        </div>
        {active.length > 0 && <div className="mt-6 flex justify-center"><Link href="/tasks" className="inline-flex items-center gap-2 rounded-full border border-status-running/25 bg-status-running/10 px-3.5 py-1.5 text-[13px] font-medium text-status-running-fg"><span aria-hidden="true" className="size-2 rounded-full bg-status-running" />{tx(`${active.length} tasks in progress`, `${active.length} 个任务正在排队或处理`, `${active.length} 件のタスクが待機中または処理中`)}<ArrowRight className="size-3.5" /></Link></div>}
      </div>
    </section>
    <div className="mx-auto max-w-6xl space-y-12 px-5 py-10 sm:px-8 lg:py-14">
      {taskError && <div className="space-y-2"><InlineAlert>{taskError}</InlineAlert><Button variant="outline" onClick={refreshTasks}>{tx('Reload tasks', '重新加载任务', 'タスクを再読み込み')}</Button></div>}
      {active.length > 0 && <TaskSection id="studio-active" title={tx('In progress', '进行中', '処理中')}><div className="grid gap-3 lg:grid-cols-2">{active.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex items-center gap-4 rounded-2xl border border-border bg-card p-3 pr-4 shadow-card transition-[border-color,transform] outline-none hover:-translate-y-px hover:border-input focus-visible:ring-3 focus-visible:ring-ring/40"><TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="sm" className="w-24 sm:w-28" /><div className="min-w-0 flex-1 space-y-2"><div className="flex items-start justify-between gap-3"><p title={task.sourceName} className="line-clamp-2 min-w-0 text-sm font-medium break-words">{task.sourceName}</p><TaskState status={task.status} /></div><TaskProgress task={task} /></div></Link>)}</div></TaskSection>}
      <TaskSection id="studio-recent" title={tx('Recent tasks', '最近任务', '最近のタスク')}>
        {!tasks && !taskError ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">{[0, 1, 2].map((item) => <div key={item} className="overflow-hidden rounded-2xl border border-border bg-card"><div className="aspect-video animate-pulse bg-accent" /><div className="space-y-2.5 p-4"><div className="h-4 w-4/5 animate-pulse rounded-md bg-accent" /><div className="h-3 w-2/5 animate-pulse rounded-md bg-accent" /></div></div>)}</div>
          : tasks && recent.length === 0 ? <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-muted px-6 py-14 text-center"><BrandMark className="h-8 opacity-60 grayscale" /><p className="mt-5 text-sm font-medium">{tx('No finished tasks yet', '还没有完成的任务', '完了したタスクはまだありません')}</p></div>
          : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{recent.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-[border-color,box-shadow,transform] outline-none hover:-translate-y-0.5 hover:border-input hover:shadow-float focus-visible:ring-3 focus-visible:ring-ring/40"><TaskCover id={task.id} src={task.cover?.url} processing={task.status === 'running'} size="md" className="rounded-none ring-0" /><div className="flex flex-1 flex-col gap-3 p-4"><p title={task.sourceName} className="line-clamp-2 text-sm leading-snug font-medium break-words">{task.sourceName}</p><div className="mt-auto flex items-center justify-between gap-3"><TaskState status={task.status} /><time className="text-xs text-muted-foreground" dateTime={task.createdAt}>{formatDateTime(task.createdAt)}</time></div></div></Link>)}</div>}
      </TaskSection>
    </div>
  </main>
}
export const name = 'client-studio'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'studio', path: '/', component: Studio, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'studio', routeId: 'studio', label: { default: 'Studio', translations: { zh: '工作台', ja: 'スタジオ' } }, order: 10, icon: Sparkles }))
}
