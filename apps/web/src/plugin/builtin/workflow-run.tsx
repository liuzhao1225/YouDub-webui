import { useEffect, useState } from 'react'
import { ArrowRight, Download, Loader2 } from 'lucide-react'
import { Link, text, useClient, type Diagnostic, type JsonObject, type NodeTypeDefinition, type TaskView, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { ConfigEditor } from './schema-form'
import { nodeDefinition } from './workflow-utils'

type ResourceState = {
  status: string; error?: string | { message?: string }
  requirements?: { providerId: string; model?: string; ready: boolean; automatic: boolean; reason?: string }[]
  environment?: { id: string; name: string; status: string; detail?: string }[]
  models?: { id: string; name: string; status: string; error?: string; received?: number; total?: number; speed?: number }[]
  activePreparation?: { status: string; error?: string }
}
export function WorkflowRun({ document, types, revision = null, onStarted }: { document: WorkflowDocument; types: NodeTypeDefinition[]; revision?: number | null; onStarted?(): void }) {
  const tx = useText(), { language } = useI18n(), { apiClient, navigation } = useClient()
  const [files, setFiles] = useState<Record<string, File>>({})
  const [runtime, setRuntime] = useState<Record<string, JsonObject>>({})
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [resource, setResource] = useState<ResourceState | null>(null)
  const [resourceKey, setResourceKey] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState('')
  const complete = document.inputs.every((input) => !input.required || files[input.id])
  const selectionKey = JSON.stringify(document.nodes.map((node) => node.provider))
  const shownResource = selectionKey === resourceKey ? resource : null
  useEffect(() => {
    if (shownResource?.status !== 'preparing') return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void apiClient.request<ResourceState>('/api/v2/workflow-documents/resources/check', { method: 'POST', body: JSON.stringify({ document }), signal: controller.signal }).then((result) => {
        setResource(result)
        if (result.status === 'ready') window.dispatchEvent(new Event('youdub:resources-ready'))
      }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message) })
    }, 1200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [apiClient, document, shownResource])
  async function checkResources(prepare = false) {
    setBusy(true); setError('')
    try {
      const result = await apiClient.request<ResourceState>(`/api/v2/workflow-documents/resources/${prepare ? 'prepare' : 'check'}`, { method: 'POST', body: JSON.stringify({ document }) })
      setResource(result); setResourceKey(selectionKey)
      if (result.status === 'ready') window.dispatchEvent(new Event('youdub:resources-ready'))
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  async function run() {
    setBusy(true); setError(''); setDiagnostics([])
    try {
      const validation = await apiClient.request<{ valid: boolean; diagnostics: Diagnostic[] }>('/api/v2/workflow-documents/validate', { method: 'POST', body: JSON.stringify({ document, nodeRuntimeInputs: runtime }) })
      setDiagnostics(validation.diagnostics)
      if (!validation.valid) return
      const id = pending || crypto.randomUUID()
      setPending(id)
      const body = new FormData()
      body.set('request', JSON.stringify({ id, workflowId: 'youdub.graph', workflowVersion: '1.0.0', graphDocument: document, nodeRuntimeInputs: runtime, config: {}, documentRevision: revision }))
      Object.entries(files).forEach(([name, file]) => body.set(`input.${name}`, file))
      const task = await apiClient.request<TaskView>('/api/v2/tasks', { method: 'POST', body })
      onStarted?.(); navigation.push(`/tasks/${task.id}`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <section className="space-y-5">
    {document.inputs.map((input) => <label key={input.id} className="grid gap-2 text-sm">{input.label}{input.required ? ' *' : ''}
      <input className="block w-full min-w-0 rounded-xl border border-dashed border-input bg-muted p-4 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-card file:px-3 file:py-2 file:text-foreground" type="file" accept={input.acceptedMimeTypes.join(',')} disabled={busy || !!pending} onChange={(event) => {
        const file = event.target.files?.[0]
        if (file && file.size > input.maxBytes) { setError(tx('File exceeds the size limit.', '文件超过大小限制。', 'ファイルのサイズが上限を超えています。')); event.target.value = ''; return }
        setFiles((current) => { const next = { ...current }; if (file) next[input.id] = file; else delete next[input.id]; return next })
      }} />
    </label>)}
    {document.nodes.map((node) => { const definition = nodeDefinition(node, types); return definition?.runtimeInputSchema ? <fieldset className="space-y-3" key={node.id}><legend className="mb-2 text-sm font-medium">{node.label || text(definition.label, language)}</legend><ConfigEditor ownerId={`runtime:${node.type}`} value={runtime[node.id] ?? {}} schema={definition.runtimeInputSchema} diagnostics={[]} readOnly={busy || !!pending} onChange={(value) => setRuntime((current) => ({ ...current, [node.id]: value }))} /></fieldset> : null })}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void checkResources()}>{tx('Check dependencies', '检查依赖', '依存関係を確認')}</Button><Button variant="outline" disabled={busy || !!pending || shownResource?.status === 'preparing' || shownResource?.activePreparation?.status === 'preparing'} onClick={() => void checkResources(true)}><Download />{tx('Prepare dependencies', '准备依赖', '依存関係を準備')}</Button></div>
    {shownResource && <div className="space-y-2 text-xs" role="status">
      <p>{tx('Preparation', '准备状态', '準備状態')}: {shownResource.status === 'ready' ? tx('Ready', '已就绪', '準備完了') : shownResource.status === 'preparing' ? tx('Preparing', '准备中', '準備中') : shownResource.status === 'failed' ? tx('Failed', '失败', '失敗') : tx('Dependencies missing', '缺少依赖', '依存関係が不足しています')}</p>
      {shownResource.requirements?.filter((item) => !item.ready).map((item) => <p key={`${item.providerId}:${item.model}`}>{item.providerId}{item.model ? ` · ${item.model}` : ''}: {item.reason || tx('Not ready', '未就绪', '準備できていません')}</p>)}
      {shownResource.environment?.map((item) => <div key={item.id}><span>{item.name} · {item.status}</span>{item.detail && <p className="text-muted-foreground">{item.detail}</p>}</div>)}
      {shownResource.models?.map((item) => <div key={item.id}><p>{item.name} · {item.status}</p>{item.total ? <progress max={item.total} value={item.received ?? 0} aria-label={item.name} className="h-1 w-full accent-primary" /> : null}{item.error && <p className="text-status-danger-fg">{item.error}</p>}</div>)}
      {shownResource.error && <InlineAlert>{typeof shownResource.error === 'string' ? shownResource.error : shownResource.error.message}</InlineAlert>}
      {shownResource.activePreparation && <InlineAlert tone="warning">{shownResource.activePreparation.status === 'preparing' ? tx('Dependencies for another workflow are being prepared.', '另一工作流的依赖正在准备中。', '別のワークフローの依存関係を準備中です。') : shownResource.activePreparation.error}</InlineAlert>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void checkResources()}>{tx('Refresh progress', '刷新进度', '進捗を更新')}</Button>
    </div>}
    {diagnostics.map((item, index) => <InlineAlert key={index}>{item.nodeId ? `${item.nodeId}: ` : ''}{item.message}</InlineAlert>)}
    {error && <InlineAlert>{error}</InlineAlert>}
    {pending && !busy && <div className="space-y-3">
      <p className="break-all text-xs text-muted-foreground">{tx('Submission needs verification:', '提交结果待核实：', '送信結果を確認してください：')}{pending}</p>
      <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request<TaskView>(`/api/v2/tasks/${pending}`).then((task) => { onStarted?.(); navigation.push(`/tasks/${task.id}`) }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Check task status', '查询创建结果', 'タスクを確認')}</Button>
      <Button variant="outline" onClick={() => { setBusy(true); void apiClient.request(`/api/v2/imports/${pending}`, { method: 'DELETE' }).then(() => { setPending(''); setError('') }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx('Clear import and edit', '清理本次导入并修改', 'インポートを削除して編集')}</Button>
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground">{tx('Connection settings', '连接设置', '接続設定')}</Link>
      <Button disabled={busy || !complete || !!pending} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{tx('Start workflow', '运行工作流', 'ワークフローを実行')}</Button>
    </div>
  </section>
}
