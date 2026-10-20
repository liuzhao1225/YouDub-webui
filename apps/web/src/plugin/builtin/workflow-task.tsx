import { useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, Download, GitBranch, Loader2, Save, Search } from 'lucide-react'
import { Link, text, useClient, useSlot, type JsonObject, type NodeDetailProps, type NodeTypeDefinition, type PanelProps, type RouteProps, type TaskNodeDetail, type TaskView, type WorkflowDocumentRecord } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { useReleaseMediaOnUnmount } from '@/lib/media'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineAlert } from '@/components/inline-alert'
import { useQuery } from './use-query'
import { WorkflowCanvas } from './workflow-canvas'
import { TaskState } from './task-status'
import { NodePluginBoundary } from './workflow-settings'
import { nodeDefinition } from './workflow-utils'
import { useUnsavedChanges } from './workflow-guard'

type Transcript = { detected_language: string; segments: { id: string | number; start_ms: number; end_ms: number; text: string; words?: unknown; speaker_id?: string }[] }
type Translation = { source_language: string; target_language: string; segments: { segment_id: string | number; text: string }[] }
type RerunPreview = { reusedSteps: string[]; dirtySteps: string[]; expectedAttempt: number; expectedTaskRevision: number; sourceRevisions: Record<string, number> }

export function TaskWorkflowPanel({ task }: PanelProps) {
  if (!task.graphSnapshot) return null
  return <TaskGraph task={task} />
}
function TaskGraph({ task }: { task: TaskView }) {
  const tx = useText(), { apiClient, navigation } = useClient()
  const { data, error } = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false)
  const paused = task.steps.find((step) => step.status === 'awaiting_review')
  return <section className="overflow-hidden rounded-2xl border border-border bg-card">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">{task.graphSnapshot!.title}</h2><div className="flex flex-wrap gap-2">
      {paused && <Button onClick={() => navigation.push(`/tasks/${task.id}/nodes/${paused.id}`)}><Check />{tx('Review result', '确认结果', '結果を確認')}</Button>}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => {
        setBusy(true); setFailure('')
        const document = { ...task.graphSnapshot!, id: crypto.randomUUID(), title: `${task.graphSnapshot!.title} · ${tx('Copy', '副本', 'コピー')}` }
        void apiClient.request<WorkflowDocumentRecord>('/api/v2/workflow-documents', { method: 'POST', body: JSON.stringify({ document }) }).then((record) => navigation.push(`/workflows/${record.id}?sourceTask=${task.id}`)).catch((failure: Error) => setFailure(failure.message)).finally(() => setBusy(false))
      }}><Copy />{tx('Edit workflow copy', '编辑工作流副本', 'ワークフローのコピーを編集')}</Button>
    </div></header>
    {(error || failure) && <div className="p-4"><InlineAlert>{error || failure}</InlineAlert></div>}
    <div className="h-[min(60dvh,36rem)] min-h-80">{data && <WorkflowCanvas document={task.graphSnapshot!} types={data.items} steps={task.steps} readOnly onOpen={(id) => navigation.push(`/tasks/${task.id}/nodes/${id}`)} />}</div>
  </section>
}

export function TaskNodePage({ params }: RouteProps) {
  const tx = useText()
  const task = useQuery<TaskView>(`/api/v2/tasks/${encodeURIComponent(params.id)}`, 2000)
  const detail = useQuery<TaskNodeDetail>(`/api/v2/tasks/${encodeURIComponent(params.id)}/nodes/${encodeURIComponent(params.nodeId)}`, 2000)
  const types = useQuery<{ items: NodeTypeDefinition[] }>('/api/v2/node-types')
  const failure = task.error || detail.error || types.error
  if (!task.data || !detail.data || !types.data) return <main className="p-6">{failure ? <InlineAlert>{failure}</InlineAlert> : <p role="status">{tx('Loading…', '正在加载…', '読み込み中…')}</p>}</main>
  return <NodeDetail task={task.data} detail={detail.data} types={types.data.items} error={failure} refresh={() => { task.refresh(); detail.refresh() }} />
}
function NodeDetail({ task, detail, types, error, refresh }: { task: TaskView; detail: TaskNodeDetail; types: NodeTypeDefinition[]; error: string; refresh(): void }) {
  const tx = useText(), { language } = useI18n(), { apiClient, navigation } = useClient()
  const node = task.graphSnapshot?.nodes.find((item) => item.id === detail.nodeId)
  const definition = node && nodeDefinition(node, types)
  const details = useSlot('workflow.node.details')
  const Custom = details.find((entry) => entry.id === definition?.ui?.detailId)?.component
  const [patch, setPatch] = useState<JsonObject>({})
  const [tab, setTab] = useState<'result' | 'inputs' | 'config' | 'log'>('result')
  const [viewRevision, setViewRevision] = useState<number | null>(null)
  const [failure, setFailure] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState('')
  const [preview, setPreview] = useState<RerunPreview | null>(null), [newTaskId, setNewTaskId] = useState('')
  const revision = viewRevision ?? detail.outputRevision
  const result = detail.resultRevisions.find((item) => item.revision === revision)
  const outputs = result?.outputs ?? detail.step.outputs ?? {}
  const displayed = { ...outputs, ...patch }
  const dirty = Object.keys(patch).length > 0
  const canReview = detail.status === 'paused' && detail.step.status === 'awaiting_review' && revision === detail.outputRevision
  const canDerive = ['succeeded', 'failed', 'cancelled'].includes(detail.status) && !!result && revision === detail.outputRevision
  const editable = (canReview || canDerive) && !!definition?.corrections && !busy && !pending && !newTaskId
  const transcript = (detail.inputs.transcript ?? displayed.transcript) as Transcript | undefined
  const baseline = useRef({ revision, taskRevision: detail.taskRevision })
  function changeDraft(next: JsonObject) {
    if (!dirty) baseline.current = { revision, taskRevision: detail.taskRevision }
    setPatch(next); setPreview(null)
  }
  const guard = useUnsavedChanges(dirty, canReview ? () => submit(false) : undefined)
  async function submit(continueAfter: boolean) {
    if (!canReview || pending) throw new Error(tx('This result cannot be approved now.', '当前结果无法确认。', 'この結果は現在確認できません。'))
    setBusy(true); setFailure('')
    const actionId = crypto.randomUUID()
    const body = { actionId, expectedAttempt: detail.attempt, expectedTaskRevision: dirty ? baseline.current.taskRevision : detail.taskRevision, expectedOutputRevision: dirty ? baseline.current.revision : detail.outputRevision, ...(dirty ? { patch, continue: continueAfter } : {}) }
    try {
      setPending(actionId)
      await apiClient.request(`/api/v2/tasks/${task.id}/nodes/${detail.nodeId}/${dirty ? 'corrections' : 'approve'}`, { method: 'POST', body: JSON.stringify(body) })
      setPending(''); setPatch({}); setViewRevision(null); refresh()
      if (continueAfter) { guard.bypass(); navigation.push(`/tasks/${task.id}`) }
    } catch (error) {
      if ((error as { status?: number }).status && (error as { status: number }).status < 500) setPending('')
      setFailure(error instanceof Error ? error.message : String(error)); throw error
    } finally { setBusy(false) }
  }
  async function rerunPreview() {
    setBusy(true); setFailure('')
    try {
      const request = { config: {}, graphDocument: task.graphSnapshot, expectedAttempt: detail.attempt, expectedTaskRevision: detail.taskRevision, corrections: { [detail.nodeId]: { revision, patch } } }
      setPreview(await apiClient.request<RerunPreview>(`/api/v2/tasks/${task.id}/rerun-preview`, { method: 'POST', body: JSON.stringify(request) }))
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  async function createDerived() {
    if (!preview) return
    setBusy(true); setFailure('')
    const id = crypto.randomUUID(); setNewTaskId(id)
    try {
      const next = await apiClient.request<TaskView>(`/api/v2/tasks/${task.id}/rerun`, { method: 'POST', body: JSON.stringify({ ...preview, id, config: {}, graphDocument: task.graphSnapshot, corrections: { [detail.nodeId]: { revision, patch } } }) })
      setPatch({}); guard.bypass(); navigation.push(`/tasks/${next.id}`)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  const generic = <ResultViewer taskId={task.id} value={displayed} />
  return <main className="mx-auto max-w-6xl space-y-5 px-5 py-8 sm:px-8">
    {guard.dialog}
    <Link href={`/tasks/${task.id}`} className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />{tx('Back to workflow', '返回工作流', 'ワークフローへ戻る')}</Link>
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">{node?.label || text(definition?.label, language) || text(detail.step.label, language)}</h1><TaskState status={detail.step.status} /></header>
    {(error || failure) && <InlineAlert>{error || failure}</InlineAlert>}
    {detail.step.error && <InlineAlert>{detail.step.error.message}</InlineAlert>}
    {pending && <div className="space-y-2"><InlineAlert tone="warning">{tx('Submission needs verification.', '提交结果待核实。', '送信結果を確認してください。')}</InlineAlert><Button variant="outline" disabled={busy} onClick={() => {
      setBusy(true); void apiClient.request(`/api/v2/tasks/${task.id}/actions/${pending}`).then(() => { setPending(''); setPatch({}); refresh() }).catch((error: Error & { status?: number }) => { setFailure(error.message); if (error.status === 404) setPending('') }).finally(() => setBusy(false))
    }}>{tx('Check submission', '查询提交结果', '送信結果を確認')}</Button></div>}
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">{(['result', 'inputs', 'config', 'log'] as const).map((value) => <Button key={value} variant={tab === value ? 'secondary' : 'ghost'} size="sm" onClick={() => setTab(value)}>{value === 'result' ? tx('Results', '结果', '結果') : value === 'inputs' ? tx('Inputs', '输入', '入力') : value === 'config' ? tx('Configuration', '配置', '設定') : tx('Log', '日志', 'ログ')}</Button>)}
      {!!detail.resultRevisions.length && <label className="ml-auto flex items-center gap-2 text-xs">{tx('Version', '版本', 'バージョン')}<select className="h-8 rounded-lg border border-input bg-input-bg px-2" disabled={dirty || busy || !!pending} value={revision} onChange={(event) => setViewRevision(Number(event.target.value))}>{detail.resultRevisions.map((item) => <option key={item.revision} value={item.revision}>{item.revision} · {item.source === 'computed' ? tx('Original', '原始结果', '元の結果') : tx('Correction', '订正', '修正')}{detail.approvedRevision === item.revision ? ` · ${tx('Approved', '已确认', '確認済み')}` : ''}</option>)}</select></label>}
    </div>
    {revision !== detail.outputRevision && !!definition?.corrections && (detail.status === 'paused' || ['succeeded', 'failed', 'cancelled'].includes(detail.status)) && <Button variant="outline" size="sm" disabled={busy || !!pending} onClick={() => {
      baseline.current = { revision: detail.outputRevision, taskRevision: detail.taskRevision }
      setPatch(Object.fromEntries(definition.corrections!.outputPorts.filter((port) => port in outputs).map((port) => [port, structuredClone(outputs[port])])))
      setViewRevision(null); setPreview(null)
    }}>{tx('Restore this version as a correction', '将此版本恢复为订正', 'このバージョンを修正案に復元')}</Button>}
    {tab === 'result' && <section className="space-y-5">
      {!Object.keys(outputs).length && <p className="text-sm text-muted-foreground">{tx('No result yet.', '尚无结果。', '結果はまだありません。')}</p>}
      {Custom ? <NodePluginBoundary key={definition!.ui!.detailId} fallback={generic}><Custom detail={detail} outputs={outputs} draft={patch} readOnly={!editable} onDraftChange={changeDraft} /></NodePluginBoundary> : definition?.ui?.detailId ? <><InlineAlert>{tx('The node detail plugin is unavailable.', '节点详情插件不可用。', 'ノード詳細プラグインがありません。')}</InlineAlert>{generic}</> : definition?.corrections?.outputPorts.includes('transcript') && displayed.transcript ? <TranscriptEditor value={displayed.transcript as Transcript} readOnly={!editable} onChange={(value) => changeDraft({ ...patch, transcript: value })} /> : definition?.corrections?.outputPorts.includes('translation') && displayed.translation ? <TranslationEditor value={displayed.translation as Translation} transcript={transcript} readOnly={!editable} onChange={(value) => changeDraft({ ...patch, translation: value })} /> : generic}
      {Object.entries(displayed).filter(([name]) => name !== 'transcript' && name !== 'translation').map(([name, value]) => <details key={name} className="rounded-xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">{name}</summary><div className="mt-3"><ResultViewer taskId={task.id} value={value} /></div></details>)}
    </section>}
    {tab === 'inputs' && <ResultViewer taskId={task.id} value={detail.inputs} />}
    {tab === 'config' && <pre className="overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-5 text-xs">{JSON.stringify(node ?? detail.spec, null, 2)}</pre>}
    {tab === 'log' && <NodeLog taskId={task.id} />}
    {canReview && <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-card p-4 shadow-card lg:bottom-4">
      {dirty && <span className="mr-auto text-xs text-muted-foreground">{tx('Unsaved correction', '订正未保存', '修正は未保存です')}</span>}
      <Button variant="outline" disabled={!dirty || busy || !!pending} onClick={() => void submit(false).catch(() => undefined)}><Save />{tx('Save correction', '保存订正', '修正を保存')}</Button>
      <Button disabled={busy || !!pending} onClick={() => void submit(true).catch(() => undefined)}>{busy ? <Loader2 className="animate-spin" /> : <Check />}{dirty ? tx('Save and continue', '保存并继续', '保存して続行') : tx('Approve and continue', '确认并继续', '確認して続行')}</Button>
    </div>}
    {canDerive && dirty && <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">{tx('Generate a new run', '创建新的运行', '新しい実行を作成')}</h2>
      {!preview && <Button disabled={busy || !!newTaskId} variant="outline" onClick={() => void rerunPreview()}><GitBranch />{tx('Preview reused nodes', '预览复用节点', '再利用ノードを確認')}</Button>}
      {preview && <><p className="text-sm">{tx('Reuse', '复用', '再利用')}: {preview.reusedSteps.join(', ') || '—'}</p><p className="text-sm">{tx('Recompute', '重新计算', '再計算')}: {preview.dirtySteps.join(', ') || '—'}</p><Button disabled={busy || !!newTaskId} onClick={() => void createDerived()}>{tx('Create new run', '创建新运行', '新しい実行を作成')}</Button></>}
      {newTaskId && !busy && <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request<TaskView>(`/api/v2/tasks/${newTaskId}`).then((next) => { guard.bypass(); navigation.push(`/tasks/${next.id}`) }).catch((error: Error) => setFailure(error.message)).finally(() => setBusy(false)) }}>{tx('Check task status', '查询创建结果', 'タスクを確認')}</Button>}
      {newTaskId && !busy && <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request(`/api/v2/imports/${newTaskId}`, { method: 'DELETE' }).then(() => { setNewTaskId(''); setPreview(null); setFailure('') }).catch((error: Error) => setFailure(error.message)).finally(() => setBusy(false)) }}>{tx('Clear import and edit', '清理本次导入并修改', 'インポートを削除して編集')}</Button>}
    </section>}
  </main>
}
function TranscriptEditor({ value, readOnly, onChange, onSeek }: { value: Transcript; readOnly: boolean; onChange(value: Transcript): void; onSeek?(seconds: number): void }) {
  const tx = useText(), [search, setSearch] = useState('')
  function update(index: number, patch: Partial<Transcript['segments'][number]>) {
    onChange({ ...value, segments: value.segments.map((segment, i) => i === index ? { ...segment, ...patch, words: null } : segment) })
  }
  return <section className="space-y-4"><div className="relative max-w-sm"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={tx('Search transcript', '搜索原文', '原文を検索')} placeholder={tx('Search transcript', '搜索原文', '原文を検索')} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {value.segments.map((segment, index) => !search || segment.text.toLowerCase().includes(search.toLowerCase()) ? <div key={segment.id} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <div className="space-y-2"><span className="text-xs text-muted-foreground">#{segment.id}</span>{onSeek && <Button size="xs" variant="ghost" onClick={() => onSeek(segment.start_ms / 1000)}>{tx('Locate', '定位', '移動')}</Button>}<div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-[11px]">{tx('Start (s)', '开始（秒）', '開始（秒）')}<Input aria-label={`${tx('Start', '开始', '開始')} ${segment.id}`} type="number" step="0.001" min="0" disabled={readOnly} value={segment.start_ms / 1000} onChange={(event) => update(index, { start_ms: Math.round(Number(event.target.value) * 1000) })} /></label><label className="grid gap-1 text-[11px]">{tx('End (s)', '结束（秒）', '終了（秒）')}<Input aria-label={`${tx('End', '结束', '終了')} ${segment.id}`} type="number" step="0.001" min="0" disabled={readOnly} value={segment.end_ms / 1000} onChange={(event) => update(index, { end_ms: Math.round(Number(event.target.value) * 1000) })} /></label></div></div>
      <textarea aria-label={`${tx('Transcript', '原文', '原文')} ${segment.id}`} className="min-h-24 w-full rounded-lg border border-input bg-input-bg p-3 text-sm focus-visible:outline-ring" disabled={readOnly} value={segment.text} onChange={(event) => update(index, { text: event.target.value })} />
    </div> : null)}
  </section>
}
export function TranscriptNodeDetails({ detail, outputs, draft, readOnly, onDraftChange }: NodeDetailProps) {
  const audio = detail.inputs.audio as { id?: string; schemaId?: string } | undefined
  const url = audio?.id ? `/api/v2/tasks/${detail.taskId}/artifacts/${audio.id}` : ''
  const ref = useRef<HTMLAudioElement>(null)
  useReleaseMediaOnUnmount(ref, url)
  const value = (draft.transcript ?? outputs.transcript) as Transcript | undefined
  return value ? <div className="space-y-5">{url && <audio ref={ref} controls preload="metadata" src={url} className="sticky top-4 z-10 w-full" />}<TranscriptEditor value={value} readOnly={readOnly} onSeek={url ? (seconds) => { if (ref.current) ref.current.currentTime = seconds } : undefined} onChange={(transcript) => onDraftChange({ ...draft, transcript })} /></div> : null
}
export function TranslationNodeDetails({ detail, outputs, draft, readOnly, onDraftChange }: NodeDetailProps) {
  const value = (draft.translation ?? outputs.translation) as Translation | undefined
  return value ? <TranslationEditor value={value} transcript={detail.inputs.transcript as Transcript | undefined} readOnly={readOnly} onChange={(translation) => onDraftChange({ ...draft, translation })} /> : null
}
function TranslationEditor({ value, transcript, readOnly, onChange }: { value: Translation; transcript?: Transcript; readOnly: boolean; onChange(value: Translation): void }) {
  const tx = useText(), [search, setSearch] = useState('')
  return <section className="space-y-4"><div className="relative max-w-sm"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={tx('Search translation', '搜索译文', '翻訳を検索')} placeholder={tx('Search translation', '搜索译文', '翻訳を検索')} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {value.segments.map((segment, index) => {
      const source = transcript?.segments.find((item) => item.id === segment.segment_id)?.text ?? ''
      if (search && !`${source} ${segment.text}`.toLowerCase().includes(search.toLowerCase())) return null
      return <div key={segment.segment_id} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2"><div><span className="text-xs text-muted-foreground">#{segment.segment_id}</span><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{source}</p></div><label className="grid gap-2 text-xs text-muted-foreground">{tx('Translation', '译文', '翻訳')}<textarea aria-label={`${tx('Translation', '译文', '翻訳')} ${segment.segment_id}`} className="min-h-28 w-full rounded-lg border border-input bg-input-bg p-3 text-sm text-foreground focus-visible:outline-ring" disabled={readOnly} value={segment.text} onChange={(event) => onChange({ ...value, segments: value.segments.map((item, i) => i === index ? { ...item, text: event.target.value } : item) })} /></label></div>
    })}
  </section>
}
function Media({ url, video }: { url: string; video: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null), videoRef = useRef<HTMLVideoElement>(null)
  useReleaseMediaOnUnmount(audioRef, url); useReleaseMediaOnUnmount(videoRef, url)
  return video ? <video ref={videoRef} src={url} controls preload="metadata" className="max-h-96 w-full rounded-xl bg-black" /> : <audio ref={audioRef} src={url} controls preload="metadata" className="w-full" />
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
  return <div className="space-y-4">{[...artifacts.values()].map((artifact) => {
    const url = `/api/v2/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifact.id)}`
    return <div key={artifact.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
      {artifact.schemaId.startsWith('audio/') || artifact.schemaId.startsWith('video/') ? <Media url={url} video={artifact.schemaId.startsWith('video/')} /> : null}
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-link"><Download className="size-4" />{tx('Open file', '打开文件', 'ファイルを開く')} · {artifact.schemaId}</a>
    </div>
  })}<pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-4 text-xs">{JSON.stringify(value, null, 2)}</pre></div>
}
function NodeLog({ taskId }: { taskId: string }) {
  const tx = useText(), [error, setError] = useState('')
  const query = useQuery<string>(`/api/v2/tasks/${taskId}/log`, 3000)
  return <section className="space-y-3"><Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(query.data ?? '').catch((failure: Error) => setError(failure.message)) }}><Copy />{tx('Copy log', '复制日志', 'ログをコピー')}</Button>{(query.error || error) && <InlineAlert>{query.error || error}</InlineAlert>}<pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 text-xs">{query.data}</pre></section>
}
