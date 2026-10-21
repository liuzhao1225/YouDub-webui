import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Link, text, useClient, type Diagnostic, type JsonObject, type NodeTypeDefinition, type TaskView, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { formatBytes } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { ConfigEditor } from './schema-form'
import { nodeDefinition } from './workflow-utils'
import { useWorkflowResources, WorkflowResources } from './workflow-resources'
import { workflowDiagnostics, WorkflowDiagnostics } from './workflow-errors'

export function WorkflowRun({ document, types, revision = null, onStarted, onLockChange }: { document: WorkflowDocument; types: NodeTypeDefinition[]; revision?: number | null; onStarted?(): void; onLockChange?(locked: boolean): void }) {
  const tx = useText(), { language } = useI18n(), { apiClient, navigation } = useClient()
  const [files, setFiles] = useState<Record<string, File>>({})
  const [runtime, setRuntime] = useState<Record<string, JsonObject>>({})
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState('')
  const resources = useWorkflowResources(document)
  const complete = document.inputs.every((input) => !input.required || files[input.id])
  const locked = busy || !!pending
  useEffect(() => { onLockChange?.(locked) }, [locked, onLockChange])
  async function run() {
    if (locked || !complete || !resources.ready) return
    setBusy(true); setError(''); setDiagnostics([])
    try {
      const validation = await apiClient.request<{ valid: boolean; diagnostics: Diagnostic[] }>('/api/v2/workflow-documents/validate', { method: 'POST', body: JSON.stringify({ document, nodeRuntimeInputs: runtime }) })
      setDiagnostics(validation.diagnostics)
      if (!validation.valid) return
      const id = crypto.randomUUID()
      setPending(id)
      const body = new FormData()
      body.set('request', JSON.stringify({ id, workflowId: 'youdub.graph', workflowVersion: '1.0.0', graphDocument: document, nodeRuntimeInputs: runtime, config: {}, documentRevision: revision }))
      Object.entries(files).forEach(([name, file]) => body.set(`input.${name}`, file))
      const task = await apiClient.request<TaskView>('/api/v2/tasks', { method: 'POST', body })
      onStarted?.(); navigation.push(`/tasks/${task.id}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure)); setDiagnostics(workflowDiagnostics(failure))
    } finally { setBusy(false) }
  }
  return <section className="space-y-5">
    {document.inputs.map((input) => <label key={input.id} className="grid gap-2 text-sm">{input.label}{input.required ? ' *' : ''}
      <input className="block w-full min-w-0 rounded-xl border border-dashed border-input bg-muted p-4 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-card file:px-3 file:py-2 file:text-foreground" type="file" accept={input.acceptedMimeTypes.join(',')} disabled={locked} onChange={(event) => {
        const file = event.target.files?.[0]
        if (file && file.size > input.maxBytes) {
          setFiles((current) => { const next = { ...current }; delete next[input.id]; return next })
          setError(tx(`${file.name} exceeds the ${formatBytes(input.maxBytes)} limit.`, `${file.name} 超过大小上限 ${formatBytes(input.maxBytes)}。`, `${file.name} はサイズ上限 ${formatBytes(input.maxBytes)} を超えています。`))
          event.target.value = ''; return
        }
        setError('')
        setFiles((current) => { const next = { ...current }; if (file) next[input.id] = file; else delete next[input.id]; return next })
      }} />
    </label>)}
    {document.nodes.map((node) => { const definition = nodeDefinition(node, types); return definition?.runtimeInputSchema ? <fieldset className="space-y-3" key={node.id}><legend className="mb-2 text-sm font-medium">{node.label || text(definition.label, language)}</legend><ConfigEditor ownerId={`runtime:${node.type}`} value={runtime[node.id] ?? {}} schema={definition.runtimeInputSchema} diagnostics={[]} readOnly={locked} onChange={(value) => { setRuntime((current) => ({ ...current, [node.id]: value })); setDiagnostics([]) }} /></fieldset> : null })}
    <WorkflowResources resources={resources} types={types} disabled={locked} />
    {error && <InlineAlert>{error}</InlineAlert>}
    <WorkflowDiagnostics diagnostics={diagnostics} document={document} types={types} />
    {pending && !busy && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{tx('Check whether the task was created before submitting again.', '请先查询任务是否已创建，再重新提交。', '再送信する前にタスクが作成されたか確認してください。')}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request<TaskView>(`/api/v2/tasks/${pending}`).then((task) => { onStarted?.(); navigation.push(`/tasks/${task.id}`) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Check created task', '查询创建结果', '作成結果を確認')}</Button>
        <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request(`/api/v2/imports/${pending}`, { method: 'DELETE' }).then(() => { setPending(''); setError(''); setDiagnostics([]) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Discard submission and edit', '放弃本次提交并修改', '今回の送信を破棄して編集')}</Button>
      </div>
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      {!locked && <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground">{tx('Connection settings', '连接设置', '接続設定')}</Link>}
      <Button disabled={locked || !complete || !resources.ready} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{tx('Start workflow', '开始运行', 'ワークフローを実行')}</Button>
    </div>
  </section>
}
