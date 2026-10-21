import type { Bindings } from '../sdk'
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ArrowRight, Link2, Loader2, X } from 'lucide-react'
import { Link, text, type Diagnostic, type GraphInput, type JsonObject, type NodeTypeDefinition, type TaskView, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { formatBytes } from '@/lib/format'
import { videoSource } from '@youdub/sdk/video-source'
import { Input } from '@/components/ui/input'
import { LaunchCard, UploadSlot } from './media-upload'
import { acceptsInputMime, compatibleInputFiles, videoLinkInput, withVideoLink, type InputFile } from './workflow-launch'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { ConfigEditor } from './schema-form'
import { nodeDefinition } from './workflow-utils'
import { WorkflowResources } from './workflow-resources'
import { workflowDiagnostics, WorkflowDiagnostics } from './workflow-errors'

export type WorkflowRunDraft = { selectedFiles: InputFile[]; sourceUrl: string; runtimeByDocument: Record<string, Record<string, JsonObject>> }

export function WorkflowRun({ document, types, revision = null, afterInputs, prominent = false, draft, onDraftChange, onStarted, onLockChange, request, navigate, useSlot, useWorkflowResources }: { document: WorkflowDocument; types: NodeTypeDefinition[]; revision?: number | null; afterInputs?: ReactNode; prominent?: boolean; draft?: WorkflowRunDraft; onDraftChange?: Dispatch<SetStateAction<WorkflowRunDraft>>; onStarted?(): void; onLockChange?(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText(), { language } = useI18n()
  const [localDraft, setLocalDraft] = useState<WorkflowRunDraft>({ selectedFiles: [], sourceUrl: '', runtimeByDocument: {} })
  const { selectedFiles, sourceUrl, runtimeByDocument } = draft ?? localDraft
  const setDraft = onDraftChange ?? setLocalDraft
  const setFiles = (selectedFiles: InputFile[]) => setDraft((current) => ({ ...current, selectedFiles }))
  const setSourceUrl = (sourceUrl: string) => setDraft((current) => ({ ...current, sourceUrl }))
  const files = compatibleInputFiles(selectedFiles, document.inputs)
  const [linkTouched, setLinkTouched] = useState(false)
  const linkInput = videoLinkInput(document, types)
  let source: ReturnType<typeof videoSource> | undefined, linkError = ''
  if (linkInput && sourceUrl.trim()) {
    try { source = videoSource(sourceUrl) } catch (failure) { linkError = failure instanceof Error ? failure.message : String(failure) }
  }
  const imported = linkInput && source ? withVideoLink(document, types, linkInput.id, source.url) : undefined
  const runDocument = imported?.document ?? document
  const runtime = runtimeByDocument[document.id] ?? {}
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState('')
  const activeRuntime = Object.fromEntries(document.nodes.filter((node) => runtime[node.id]).map((node) => [node.id, runtime[node.id]]))
  const runRuntime = { ...activeRuntime, ...imported?.runtime }
  const resources = useWorkflowResources(runDocument)
  const complete = !linkError && document.inputs.every((input) => !input.required || files[input.id] || (input.id === linkInput?.id && source))
  const locked = busy || !!pending
  useEffect(() => { onLockChange?.(locked) }, [locked, onLockChange])
  async function run() {
    if (locked || !complete || !resources.ready) return
    setBusy(true); setError(''); setDiagnostics([])
    try {
      const validation = await request<{ valid: boolean; diagnostics: Diagnostic[] }>('/api/v2/workflow-documents/validate', { method: 'POST', body: JSON.stringify({ document: runDocument, nodeRuntimeInputs: runRuntime }) })
      setDiagnostics(validation.diagnostics)
      if (!validation.valid) return
      const id = crypto.randomUUID()
      setPending(id)
      const body = new FormData()
      body.set('request', JSON.stringify({ id, workflowId: 'youdub.graph', workflowVersion: '1.0.0', graphDocument: runDocument, nodeRuntimeInputs: runRuntime, config: {}, documentRevision: imported ? null : revision, ...(source ? { sourceName: source.url } : {}) }))
      Object.entries(files).filter(([name]) => !imported || name !== linkInput?.id).forEach(([name, file]) => body.set(`input.${name}`, file))
      const task = await request<TaskView>('/api/v2/tasks', { method: 'POST', body })
      onStarted?.(); navigate(`/tasks/${task.id}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure)); setDiagnostics(workflowDiagnostics(failure))
    } finally { setBusy(false) }
  }
  function changeFile(input: GraphInput, file?: File) {
    const next = document.inputs.filter((item) => item.id !== input.id && files[item.id]).map((item) => ({ input: item, file: files[item.id] }))
    if (file && !acceptsInputMime(input, file)) {
      setFiles(next)
      setError(tx(`${file.name} is not a supported file type.`, `${file.name} 的文件类型不支持。`, `${file.name} のファイル形式には対応していません。`))
      return
    }
    if (file && file.size > input.maxBytes) {
      setFiles(next)
      setError(tx(`${file.name} exceeds the ${formatBytes(input.maxBytes)} limit.`, `${file.name} 超过大小上限 ${formatBytes(input.maxBytes)}。`, `${file.name} はサイズ上限 ${formatBytes(input.maxBytes)} を超えています。`))
      return
    }
    if (file) next.push({ input, file })
    if (file && input.id === linkInput?.id) { setSourceUrl(''); setLinkTouched(false) }
    setFiles(next); setError('')
  }
  const material = <div>
    {linkInput && <div className="px-3 pt-3 pb-1">
      <div className="relative flex items-center gap-2 rounded-xl border border-input bg-muted px-3 focus-within:border-ring">
        <Link2 className="size-4 shrink-0 text-subtle-foreground" />
        <Input aria-label={tx('Video link', '视频链接', '動画リンク')} inputMode="url" autoComplete="off" value={sourceUrl} disabled={locked} placeholder={tx('Paste a YouTube or Bilibili link', '粘贴 YouTube 或 B 站视频链接', 'YouTube / Bilibili のリンクを貼り付け')} className="h-12 min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" onBlur={() => setLinkTouched(true)} onChange={(event) => {
          setSourceUrl(event.target.value); setLinkTouched(false); setError('')
          if (event.target.value) changeFile(linkInput, undefined)
        }} />
        {source && <span className="shrink-0 text-xs text-muted-foreground">{source.platform === 'Bilibili' ? 'B 站' : 'YouTube'}</span>}
        {sourceUrl && <Button variant="ghost" size="icon-sm" disabled={locked} aria-label={tx('Clear link', '清空链接', 'リンクをクリア')} onClick={() => { setSourceUrl(''); setLinkTouched(false) }}><X /></Button>}
      </div>
      {linkTouched && linkError && <div className="mt-2"><InlineAlert>{linkError}</InlineAlert></div>}
      <div className="my-4 flex items-center gap-3 text-xs text-subtle-foreground"><span className="h-px flex-1 bg-border" />{tx('or upload a video', '或上传本地视频', 'または動画をアップロード')}<span className="h-px flex-1 bg-border" /></div>
    </div>}
    <div className="grid gap-3">{document.inputs.map((input) => <UploadSlot key={input.id} slot={{ ...input, name: input.id }} file={files[input.id]} disabled={locked} alternative={input.id === linkInput?.id} onChange={(file) => changeFile(input, file)} />)}</div>
    </div>
  const status = <div className="space-y-3">
    {document.nodes.map((node) => { const definition = nodeDefinition(node, types); return definition?.runtimeInputSchema ? <fieldset className="space-y-3" key={node.id}><legend className="mb-2 text-sm font-medium">{node.label || text(definition.label, language)}</legend><ConfigEditor useSlot={useSlot} ownerId={`runtime:${node.type}`} value={runtime[node.id] ?? {}} schema={definition.runtimeInputSchema} diagnostics={[]} readOnly={locked} onChange={(value) => { setDraft((current) => ({ ...current, runtimeByDocument: { ...current.runtimeByDocument, [document.id]: { ...current.runtimeByDocument[document.id], [node.id]: value } } })); setDiagnostics([]) }} /></fieldset> : null })}
    <WorkflowResources resources={resources} types={types} disabled={locked} hideReady={prominent} />
    {error && <InlineAlert>{error}</InlineAlert>}
    <WorkflowDiagnostics diagnostics={diagnostics} document={runDocument} types={types} />
    {pending && !busy && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{tx('Check whether the task was created before submitting again.', '请先查询任务是否已创建，再重新提交。', '再送信する前にタスクが作成されたか確認してください。')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { setBusy(true); void request<TaskView>(`/api/v2/tasks/${pending}`).then((task) => { onStarted?.(); navigate(`/tasks/${task.id}`) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Check created task', '查询创建结果', '作成結果を確認')}</Button>
        <Button variant="outline" onClick={() => { setBusy(true); void request(`/api/v2/imports/${pending}`, { method: 'DELETE' }).then(() => { setPending(''); setError(''); setDiagnostics([]) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Discard submission and edit', '放弃本次提交并修改', '今回の送信を破棄して編集')}</Button>
      </div>
    </div>}
  </div>
  const quietResources = resources.ready && resources.result?.status === 'ready' && !resources.checking && !resources.error && !resources.result.error && !resources.result.activePreparation
  const showStatus = !quietResources || error || diagnostics.length > 0 || (pending && !busy) || document.nodes.some((node) => nodeDefinition(node, types)?.runtimeInputSchema)
  const submit = <Button size={prominent ? "xl" : "default"} className={prominent ? "w-full shrink-0 sm:ml-auto sm:w-auto" : undefined} disabled={locked || !complete || !resources.ready} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{prominent ? source ? tx('Download and process', '下载并处理', 'ダウンロードして処理') : tx('Start processing', '开始处理', '処理を開始') : tx('Start workflow', '开始运行', 'ワークフローを実行')}</Button>
  if (prominent) return <div className="space-y-4"><LaunchCard>{material}<div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border px-2 pt-2.5 pb-1"><div className="min-w-0 flex-1">{afterInputs}</div>{submit}</div></LaunchCard>{showStatus ? status : null}</div>
  return <section className="space-y-5">{material}{afterInputs}{status}<div className="flex flex-wrap items-center justify-between gap-3">{!locked && <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground">{tx('Connection settings', '连接设置', '接続設定')}</Link>}{submit}</div></section>
}
