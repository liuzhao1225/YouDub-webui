import type { Bindings } from '../sdk'
import { useEffect, useState } from 'react'
import { ArrowRight, GitBranch, Loader2, Square } from 'lucide-react'
import { Link, text, type Diagnostic, type JsonObject, type NodeTypeDefinition, type TaskView, type WorkflowDocument } from '../sdk'
import { taskNeedsPolling } from '../runtime/query'
import { useActiveView } from '../view-hooks'
import { useI18n, useText } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { ConfigEditor } from './schema-form'
import { nodeDefinition } from './workflow-utils'
import { WorkflowResources } from './workflow-resources'
import { workflowDiagnostics, WorkflowDiagnostics } from './workflow-errors'

type Preview = { reusedSteps: string[]; dirtySteps: string[]; expectedAttempt: number; expectedTaskRevision: number; sourceRevisions: Record<string, number> }
export function WorkflowRerun({ taskId, document, types, onStarted, onLockChange, request, navigate, useQuery, useSlot, useWorkflowResources }: { taskId: string; document: WorkflowDocument; types: NodeTypeDefinition[]; onStarted(): void; onLockChange?(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useQuery' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText(), { language } = useI18n()
  const activeView = useActiveView()
  const task = useQuery<TaskView>(`/api/v2/tasks/${taskId}`, 2000, taskNeedsPolling)
  const resources = useWorkflowResources(document)
  const [preview, setPreview] = useState<{ document: string; result: Preview } | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState('')
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [runtime, setRuntime] = useState<Record<string, JsonObject>>({})
  const runtimeInputs = Object.fromEntries(document.nodes.filter((node) => nodeDefinition(node, types)?.runtimeInputSchema).map((node) => [node.id, runtime[node.id] ?? task.data?.nodeRuntimeInputs?.[node.id] ?? {}]))
  const fingerprint = JSON.stringify({ document, runtimeInputs })
  const current = preview?.document === fingerprint && preview.result.expectedAttempt === task.data?.attempt && preview.result.expectedTaskRevision === task.data?.revision ? preview.result : null
  const terminal = task.data && ['succeeded', 'failed', 'cancelled'].includes(task.data.status)
  const locked = busy || !!pending
  useEffect(() => { onLockChange?.(locked) }, [locked, onLockChange])
  const nodeNames = (ids: string[]) => ids.map((id) => {
    const node = document.nodes.find((node) => node.id === id)
    return node?.label || (node && text(nodeDefinition(node, types)?.label, language)) || text(task.data?.steps.find((step) => step.id === id)?.label, language) || tx("workflow.rerun.node")
  }).join(tx("workflow.rerun.")) || tx("workflow.rerun.none")
  function fail(failure: unknown) {
    setError(failure instanceof Error ? failure.message : String(failure)); setDiagnostics(workflowDiagnostics(failure))
  }
  async function check() {
    if (!task.data || !terminal || locked || !resources.ready) return
    setBusy(true); setError(''); setDiagnostics([])
    try {
      const result = await request<Preview>(`/api/v2/tasks/${taskId}/rerun-preview`, { method: 'POST', body: JSON.stringify({ config: {}, graphDocument: document, nodeRuntimeInputs: runtimeInputs, expectedAttempt: task.data.attempt, expectedTaskRevision: task.data.revision }) })
      setPreview({ document: fingerprint, result })
    } catch (failure) { fail(failure) }
    finally { setBusy(false) }
  }
  async function run() {
    if (!current || !terminal || locked || !resources.ready) return
    setBusy(true); setError(''); setDiagnostics([])
    const id = crypto.randomUUID(); setPending(id)
    try {
      const next = await request<TaskView>(`/api/v2/tasks/${taskId}/rerun`, { method: 'POST', body: JSON.stringify({ ...current, id, config: {}, graphDocument: document, nodeRuntimeInputs: runtimeInputs }) })
      if (activeView.current) { onStarted(); navigate(`/tasks/${next.id}`) }
    } catch (failure) { fail(failure) }
    finally { setBusy(false) }
  }
  return <section className="space-y-4">
    {!task.data && !task.error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{tx("workflow.rerun.loading.original.task")}</p>}
    {task.error && <div className="space-y-2"><InlineAlert>{task.error}</InlineAlert><Button variant="outline" disabled={locked} onClick={task.refresh}>{tx("workflow.rerun.reload.original.task")}</Button></div>}
    {document.nodes.map((node) => { const definition = nodeDefinition(node, types); return definition?.runtimeInputSchema ? <fieldset key={node.id} className="space-y-3"><legend className="mb-2 text-sm font-medium">{node.label || text(definition.label, language)}</legend><ConfigEditor useSlot={useSlot} ownerId={`runtime:${node.type}`} schema={definition.runtimeInputSchema} value={runtimeInputs[node.id]} diagnostics={[]} readOnly={locked || !task.data} onChange={(value) => { setRuntime((current) => ({ ...current, [node.id]: value })); setPreview(null); setDiagnostics([]) }} /></fieldset> : null })}
    <WorkflowResources resources={resources} types={types} disabled={locked} />
    {task.data?.status === 'paused' && <><InlineAlert tone="warning">{tx("workflow.rerun.the.original.task.is.awaiting.review.stop.it.before.rerunning")}</InlineAlert><Button variant="outline" disabled={locked} onClick={() => {
      setBusy(true); setError(''); void request(`/api/v2/tasks/${taskId}/cancel`, { method: 'POST', body: JSON.stringify({ expectedAttempt: task.data!.attempt, expectedTaskRevision: task.data!.revision }) }).then(task.refresh).catch(fail).finally(() => setBusy(false))
    }}><Square />{tx("workflow.rerun.stop.original.task")}</Button></>}
    {task.data && !terminal && task.data.status !== 'paused' && <InlineAlert tone="warning">{tx("workflow.rerun.wait.for.the.original.task.to.finish.or.stop.it.from.its.task.pag")}</InlineAlert>}
    {!locked && <Link href={`/tasks/${taskId}`} className="inline-block text-sm text-link">{tx("workflow.rerun.back.to.original.task")}</Link>}
    {error && <InlineAlert>{error}</InlineAlert>}
    <WorkflowDiagnostics diagnostics={diagnostics} document={document} types={types} />
    {!current && <div><Button variant="outline" disabled={!terminal || locked || !resources.ready} onClick={() => void check()}>{busy ? <Loader2 className="animate-spin" /> : <GitBranch />}{tx("workflow.rerun.review.rerun.scope")}</Button></div>}
    {current && <><div className="space-y-2 text-sm"><p>{tx("workflow.rerun.keep.results")}: {nodeNames(current.reusedSteps)}</p><p>{tx("workflow.rerun.process.again")}: {nodeNames(current.dirtySteps)}</p></div><p className="text-xs text-muted-foreground">{tx("workflow.rerun.creates.a.new.task.using.the.original.media")}</p><Button disabled={!terminal || locked || !resources.ready} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{tx("workflow.rerun.run.again")}</Button></>}
    {pending && !busy && <div className="space-y-3"><p className="text-sm text-muted-foreground">{tx("workflow.rerun.check.whether.the.task.was.created.before.submitting.again")}</p><div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { setBusy(true); void request<TaskView>(`/api/v2/tasks/${pending}`).then((next) => { onStarted(); navigate(`/tasks/${next.id}`) }).catch(fail).finally(() => setBusy(false)) }}>{tx("workflow.rerun.check.created.task")}</Button>
      <Button variant="outline" onClick={() => { setBusy(true); void request(`/api/v2/imports/${pending}`, { method: 'DELETE' }).then(() => { setPending(''); setPreview(null); setError(''); setDiagnostics([]) }).catch(fail).finally(() => setBusy(false)) }}>{tx("workflow.rerun.discard.submission.and.edit")}</Button>
    </div></div>}
  </section>
}
