import { useState } from 'react'
import { GitBranch, Loader2, Square } from 'lucide-react'
import { text, useClient, type JsonObject, type NodeTypeDefinition, type TaskView, type WorkflowDocument } from '../sdk'
import { useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { useQuery } from './use-query'
import { ConfigEditor } from './schema-form'
import { nodeDefinition } from './workflow-utils'

type Preview = { reusedSteps: string[]; dirtySteps: string[]; expectedAttempt: number; expectedTaskRevision: number; sourceRevisions: Record<string, number> }
export function WorkflowRerun({ taskId, document, types, onStarted }: { taskId: string; document: WorkflowDocument; types: NodeTypeDefinition[]; onStarted(): void }) {
  const tx = useText(), { apiClient, navigation } = useClient()
  const task = useQuery<TaskView>(`/api/v2/tasks/${taskId}`, 2000)
  const [preview, setPreview] = useState<{ document: string; result: Preview } | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState('')
  const [runtime, setRuntime] = useState<Record<string, JsonObject>>({})
  const runtimeInputs = Object.fromEntries(document.nodes.filter((node) => nodeDefinition(node, types)?.runtimeInputSchema).map((node) => [node.id, runtime[node.id] ?? task.data?.nodeRuntimeInputs?.[node.id] ?? {}]))
  const fingerprint = JSON.stringify({ document, runtimeInputs })
  const current = preview?.document === fingerprint ? preview.result : null
  const terminal = task.data && ['succeeded', 'failed', 'cancelled'].includes(task.data.status)
  async function check() {
    if (!task.data) return
    setBusy(true); setError('')
    try { const result = await apiClient.request<Preview>(`/api/v2/tasks/${taskId}/rerun-preview`, { method: 'POST', body: JSON.stringify({ config: {}, graphDocument: document, nodeRuntimeInputs: runtimeInputs, expectedAttempt: task.data.attempt, expectedTaskRevision: task.data.revision }) }); setPreview({ document: fingerprint, result }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  async function run() {
    if (!current) return
    setBusy(true); setError('')
    const id = crypto.randomUUID(); setPending(id)
    try { const next = await apiClient.request<TaskView>(`/api/v2/tasks/${taskId}/rerun`, { method: 'POST', body: JSON.stringify({ ...current, id, config: {}, graphDocument: document, nodeRuntimeInputs: runtimeInputs }) }); onStarted(); navigation.push(`/tasks/${next.id}`) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <section className="space-y-4">
    {(task.error || error) && <InlineAlert>{task.error || error}</InlineAlert>}
    {document.nodes.map((node) => { const definition = nodeDefinition(node, types); return definition?.runtimeInputSchema ? <fieldset key={node.id} className="space-y-3"><legend className="mb-2 text-sm font-medium">{node.label || text(definition.label)}</legend><ConfigEditor ownerId={`runtime:${node.type}`} schema={definition.runtimeInputSchema} value={runtimeInputs[node.id]} diagnostics={[]} readOnly={busy || !!pending} onChange={(value) => { setRuntime((current) => ({ ...current, [node.id]: value })); setPreview(null) }} /></fieldset> : null })}
    {task.data?.status === 'paused' && <><InlineAlert tone="warning">{tx('Cancel the paused run before creating its replacement.', '先停止当前暂停任务，再创建替代运行。', '一時停止中の実行を停止してから、新しい実行を作成してください。')}</InlineAlert><Button variant="outline" disabled={busy} onClick={() => {
      setBusy(true); void apiClient.request(`/api/v2/tasks/${taskId}/cancel`, { method: 'POST', body: JSON.stringify({ expectedAttempt: task.data!.attempt, expectedTaskRevision: task.data!.revision }) }).then(task.refresh).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false))
    }}><Square />{tx('Stop current run', '停止当前运行', '現在の実行を停止')}</Button></>}
    {task.data && !terminal && task.data.status !== 'paused' && <InlineAlert tone="warning">{tx('The original run is still active.', '原任务仍在运行中。', '元のタスクは実行中です。')}</InlineAlert>}
    <Button variant="outline" disabled={!terminal || busy || !!pending} onClick={() => void check()}>{busy ? <Loader2 className="animate-spin" /> : <GitBranch />}{tx('Preview reused nodes', '预览复用节点', '再利用ノードを確認')}</Button>
    {current && <><div className="space-y-2 text-sm"><p>{tx('Reuse', '复用', '再利用')}: {current.reusedSteps.join(', ') || '—'}</p><p>{tx('Recompute', '重新计算', '再計算')}: {current.dirtySteps.join(', ') || '—'}</p></div><Button disabled={busy || !!pending} onClick={() => void run()}>{tx('Create new run', '创建新运行', '新しい実行を作成')}</Button></>}
    {pending && !busy && <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request<TaskView>(`/api/v2/tasks/${pending}`).then((next) => { onStarted(); navigation.push(`/tasks/${next.id}`) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Check task status', '查询创建结果', 'タスクを確認')}</Button>}
    {pending && !busy && <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request(`/api/v2/imports/${pending}`, { method: 'DELETE' }).then(() => { setPending(''); setPreview(null); setError('') }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Clear import and edit', '清理本次导入并修改', 'インポートを削除して編集')}</Button>}
  </section>
}
