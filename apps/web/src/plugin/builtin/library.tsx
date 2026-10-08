import { Context } from 'cordis'
import { useState } from 'react'
import { ArrowLeft, Check, Download, FileText, ListVideo, Loader2, RotateCw, Square, Trash2 } from 'lucide-react'
import { Link, text, useClient, useSlot, type Catalog, type JsonObject, type PanelProps, type RouteProps, type TaskAction, type TaskPage, type TaskView, type WorkflowDescription } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { formatBytes, formatDateTime } from '@/lib/format'
import { TaskCover } from '@/components/task-cover'
import { VideoPlayer } from '@/components/video-player'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { ConfigEditor, defaultConfig, useEditorSupported } from './schema-form'
import { useQuery } from './use-query'

const labels: Record<string, [string, string, string]> = { queued: ['Queued', '排队中', '順番待ち'], running: ['Running', '处理中', '処理中'], waiting: ['Waiting', '等待中', '待機中'], cancelling: ['Cancelling', '正在取消', 'キャンセル中'], cancelled: ['Cancelled', '已取消', 'キャンセル済み'], succeeded: ['Completed', '已完成', '完了'], failed: ['Failed', '失败', '失敗'], pending: ['Pending', '未开始', '未開始'], completed: ['Completed', '已完成', '完了'] }
function State({ status }: { status: string }) { const tx = useText(); return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status === 'failed' ? 'bg-status-danger/10 text-status-danger-fg' : status === 'succeeded' || status === 'completed' ? 'bg-status-success/10 text-status-success-fg' : 'bg-accent text-muted-foreground'}`}>{labels[status] ? tx(...labels[status]) : status}</span> }
function Library() {
  const tx = useText()
  const [status, setStatus] = useState(''), [offset, setOffset] = useState(0)
  const { data, error, refresh } = useQuery<TaskPage>(`/api/v2/tasks?limit=20&offset=${offset}${status ? `&status=${status}` : ''}`, 3000)
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8"><header className="mb-7 flex items-center justify-between gap-4"><div><h1 className="text-2xl font-semibold">{tx("Library", "任务库", "ライブラリ")}</h1><p className="mt-2 text-sm text-muted-foreground">{tx("Track progress and generated files.", "查看处理进度和已生成的文件。", "進捗と生成ファイルを確認できます。")}</p></div><Link href="/" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{tx("New task", "新建任务", "新しいタスク")}</Link></header><div className="mb-5 flex flex-wrap items-center gap-2"><select aria-label={tx("Task status", "任务状态", "タスクの状態")} value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0) }} className="h-9 rounded-lg border border-input bg-input-bg px-3 text-sm"><option value="">{tx("All statuses", "全部状态", "すべての状態")}</option>{['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'].map((item) => <option key={item} value={item}>{tx(...labels[item])}</option>)}</select><Button variant="ghost" size="sm" onClick={refresh}><RotateCw />{tx("Refresh", "刷新", "更新")}</Button></div>{error && <InlineAlert>{error}</InlineAlert>}{data && !data.items.length && <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">{tx("No tasks yet", "还没有任务", "タスクはまだありません")}</div>}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{data?.items.map((task) => <Link key={task.id} href={`/tasks/${task.id}`} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-colors hover:border-input"><TaskCover id={task.id} size="lg" className="rounded-none" /><div className="space-y-3 p-4"><div className="flex items-start justify-between gap-2"><h2 className="min-w-0 truncate font-medium">{task.sourceName}</h2><State status={task.status} /></div><p className="text-xs text-muted-foreground">{task.workflowId}</p><p className="text-xs text-subtle-foreground">{formatDateTime(task.createdAt)}</p>{task.error && <p className="line-clamp-2 text-xs text-status-danger-fg">{task.error.message}</p>}</div></Link>)}</div><div className="mt-6 flex justify-end gap-2"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>{tx("Previous", "上一页", "前へ")}</Button><Button variant="outline" disabled={!data?.hasMore} onClick={() => setOffset(offset + 20)}>{tx("Next", "下一页", "次へ")}</Button></div></main>
}
function RerunEditor({ task, close }: { task: TaskView; close(): void }) {
  const tx = useText()
  const { language } = useI18n()
  const { data: catalog, error } = useQuery<Catalog>('/api/v2/catalog')
  const [selected, setSelected] = useState(task.workflowId)
  const workflow = catalog?.workflows.find((item) => item.id === selected) ?? catalog?.workflows[0]
  return <section className="space-y-5 rounded-2xl border border-border bg-card p-6">
    <h2 className="font-semibold">{tx('Generate again', '重新生成', '再生成')}</h2>
    {error && <InlineAlert>{error}</InlineAlert>}
    {catalog && !workflow && <InlineAlert>{tx('No workflows are available.', '当前没有可用流程。', '利用可能なワークフローがありません。')}</InlineAlert>}
    {workflow && <><label className="grid gap-2 text-sm">{tx('Workflow', '处理流程', 'ワークフロー')}<select value={workflow.id} onChange={(event) => setSelected(event.target.value)} className="h-10 rounded-lg border border-input bg-input-bg px-3">{catalog!.workflows.map((item) => <option key={item.id} value={item.id}>{text(item.label, language)}</option>)}</select></label><RerunForm key={`${workflow.id}:${workflow.version}`} task={task} workflow={workflow} close={close} /></>}
    {!workflow && <Button variant="outline" onClick={close}>{tx('Close', '关闭', '閉じる')}</Button>}
  </section>
}
function RerunForm({ task, workflow, close }: { task: TaskView; workflow: WorkflowDescription; close(): void }) {
  const tx = useText()
  const { apiClient, navigation } = useClient()
  const [config, setConfig] = useState<JsonObject>(() => structuredClone(task.workflowId === workflow.id ? task.config : workflow.defaults ?? defaultConfig(workflow.configSchema) ?? {}) as JsonObject)
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [acknowledged, setAcknowledged] = useState(false), [submitted, setSubmitted] = useState(false)
  const [newId] = useState(() => crypto.randomUUID())
  const supported = useEditorSupported(workflow.id, workflow.configSchema)
  return <div className="space-y-5">
    <ConfigEditor ownerId={workflow.id} value={config} schema={workflow.configSchema} diagnostics={[]} readOnly={busy || submitted} onChange={setConfig} />
    {task.mayStillRun && <label className="flex gap-2 text-sm"><input type="checkbox" disabled={submitted} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />{tx('The remote request may still be running. Create a new task.', '远端请求可能仍在执行，确认创建新任务。', 'リモート処理が続いている可能性があります。新しいタスクを作成します。')}</label>}
    {failure && <InlineAlert>{failure} · {newId}</InlineAlert>}
    <div className="flex gap-2"><Button disabled={!supported || busy || (task.mayStillRun && !acknowledged)} onClick={() => {
      setBusy(true); setSubmitted(true); setFailure('')
      void apiClient.request<TaskView>(`/api/v2/tasks/${task.id}/rerun`, { method: 'POST', body: JSON.stringify({ id: newId, workflowId: workflow.id, config, acknowledgeExternalRisk: acknowledged }) }).then((next) => navigation.push(`/tasks/${next.id}`)).catch((err: Error) => setFailure(err.message)).finally(() => setBusy(false))
    }}>{busy && <Loader2 className="animate-spin" />}{submitted ? tx('Submit with the same ID', '使用同一 ID 提交', '同じ ID で送信') : tx('Create task', '创建任务', 'タスクを作成')}</Button><Button variant="outline" onClick={close} disabled={busy}>{tx('Close', '关闭', '閉じる')}</Button></div>
  </div>
}
function Actions({ task, refresh, prepareDelete }: PanelProps & { prepareDelete(value: boolean): void }) {
  const tx = useText()
  const { apiClient, navigation } = useClient()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false), [rerun, setRerun] = useState(false)
  async function act(action: TaskAction) {
    if (busy) return
    setBusy(true); setError('')
    try {
      await apiClient.request(`/api/v2/tasks/${task.id}${action === 'delete' ? `?expectedAttempt=${task.attempt}` : `/${action}`}`, { method: action === 'delete' ? 'DELETE' : 'POST', ...(action === 'delete' ? {} : { body: JSON.stringify({ expectedAttempt: task.attempt }) }) })
      if (action === 'delete') navigation.push('/tasks'); else refresh()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="space-y-4"><div className="flex flex-wrap gap-2">{task.allowedActions.includes('cancel') && <Button variant="outline" disabled={busy} onClick={() => void act('cancel')}><Square />{tx("Cancel task", "取消任务", "タスクをキャンセル")}</Button>}{task.allowedActions.includes('retry') && <Button disabled={busy} onClick={() => void act('retry')}><RotateCw />{tx("Retry from start", "从头重试", "最初から再試行")}</Button>}{task.allowedActions.includes('rerun') && <Button variant="outline" disabled={busy} onClick={() => setRerun(!rerun)}>{tx("Generate again", "重新生成", "再生成")}</Button>}{task.allowedActions.includes('delete') && <Button variant={confirmDelete ? 'destructive' : 'ghost'} disabled={busy} onClick={() => { if (confirmDelete) void act('delete'); else { setConfirmDelete(true); prepareDelete(true) } }}><Trash2 />{confirmDelete ? tx('Delete task and files', '确认删除任务与文件', 'タスクとファイルを削除') : tx('Delete task', '删除任务', 'タスクを削除')}</Button>}{confirmDelete && <Button variant="ghost" onClick={() => { setConfirmDelete(false); prepareDelete(false) }}>{tx("Keep task", "保留", "タスクを保持")}</Button>}</div>{task.mayStillRun && <InlineAlert tone="warning">{tx("The remote request may still be running.", "远端请求可能仍在执行。", "リモート処理が続いている可能性があります。")}</InlineAlert>}{error && <InlineAlert>{error}</InlineAlert>}{rerun && <RerunEditor task={task} close={() => setRerun(false)} />}</div>
}
function TaskDetail({ params }: RouteProps) {
  const tx = useText()
  const { data: task, error, refresh } = useQuery<TaskView>(`/api/v2/tasks/${encodeURIComponent(params.id)}`, 1500)
  const panels = useSlot('task.detail.panels'), actions = useSlot('task.detail.actions')
  const { language } = useI18n()
  const [showLog, setShowLog] = useState(false), [mediaReleased, setMediaReleased] = useState(false)
  if (!task) return <main className="p-8">{error ? <InlineAlert>{error}</InlineAlert> : <p role="status">{tx("Loading…", "正在加载…", "読み込み中…")}</p>}</main>
  const video = task.outputs.find((output) => output.mimeType?.startsWith('video/'))
  const completed = task.steps.filter((step) => step.status === 'completed').length
  return <main className="mx-auto max-w-6xl space-y-6 px-5 py-8 sm:px-8"><Link href="/tasks" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />{tx("Library", "任务库", "ライブラリ")}</Link><header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="break-words text-2xl font-semibold">{task.sourceName}</h1><p className="mt-2 text-xs text-muted-foreground">{task.workflowId} · {task.workflowVersion} · {formatDateTime(task.createdAt)}</p></div><State status={task.status} /></header>{error && <InlineAlert>{error}</InlineAlert>}{task.error && <InlineAlert>{task.error.message}</InlineAlert>}<Actions task={task} refresh={refresh} prepareDelete={setMediaReleased} />{actions.map(({ id, component: Component }) => <Component key={id} task={task} refresh={refresh} />)}{video && !mediaReleased && <div className="overflow-hidden rounded-2xl border border-border bg-black"><VideoPlayer src={video.url} /></div>}<div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"><section className="rounded-2xl border border-border bg-card p-6 shadow-card"><div className="mb-5 flex justify-between"><h2 className="font-semibold">{tx("Steps", "处理步骤", "処理ステップ")}</h2><span className="text-sm text-muted-foreground">{completed}/{task.steps.length}</span></div><ol className="space-y-4">{task.steps.map((step) => <li key={step.id} className="flex gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent">{step.status === 'completed' ? <Check className="size-4 text-status-success-fg" /> : step.status === 'running' ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4 text-muted-foreground" />}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{text(step.label, language)}</span><State status={step.status} /></div>{step.progress !== null && <progress aria-label={`${text(step.label, language)} ${tx("progress", "进度", "進捗")}`} value={step.progress} max={1} className="mt-2 h-1 w-full accent-primary" />}{step.message && <p className="mt-1 break-words text-xs text-muted-foreground">{step.message}</p>}{step.error && <p className="mt-1 text-xs text-status-danger-fg">{step.error.message}</p>}</div></li>)}</ol></section><section className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card"><h2 className="font-semibold">{tx("Generated files", "生成文件", "生成ファイル")}</h2>{!task.outputs.length && <p className="text-sm text-muted-foreground">{tx("No files generated yet.", "还没有生成文件。", "生成されたファイルはまだありません。")}</p>}{task.outputs.map((output) => <div key={output.id} className="space-y-2 rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{output.label || output.name || output.id}</p><p className="mt-1 text-xs text-muted-foreground">{output.mimeType}{output.size !== undefined ? ` · ${formatBytes(output.size)}` : ''}</p></div><a href={output.url} download className="rounded-lg p-2 hover:bg-accent" aria-label={`${tx("Download", "下载", "ダウンロード")} ${output.label || output.id}`}><Download className="size-4" /></a></div>{!mediaReleased && output.mimeType?.startsWith('audio/') && <audio controls src={output.url} className="h-10 w-full" />}{(output.mimeType?.startsWith('text/') || output.mimeType === 'application/x-subrip') && <a href={output.url} target="_blank" rel="noreferrer" className="text-xs text-link">{tx("Preview text", "预览字幕", "テキストを表示")}</a>}</div>)}</section></div>{panels.map(({ id, component: Component }) => <Component key={id} task={task} refresh={refresh} />)}<section className="rounded-2xl border border-border bg-card p-5"><Button variant="ghost" onClick={() => setShowLog(!showLog)}>{showLog ? tx('Hide log', '隐藏日志', 'ログを隠す') : tx('View log', '查看日志', 'ログを表示')}</Button>{showLog && <TaskLog id={task.id} />}</section></main>
}
function TaskLog({ id }: { id: string }) {
  const { data, error } = useQuery<string>(`/api/v2/tasks/${id}/log`, 2000)
  return error ? <InlineAlert>{error}</InlineAlert> : <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 font-mono text-xs">{data}</pre>
}
export const name = 'client-library'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'library', path: '/tasks', component: Library, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'task-detail', path: '/tasks/:id', component: TaskDetail, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'library', routeId: 'library', label: { default: 'Library', translations: { zh: '任务库', ja: 'タスク' } }, order: 20, icon: ListVideo }))
}
