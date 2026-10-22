import type { Bindings } from '../sdk'
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { ArrowRight, Link2, Loader2, X } from '@/lib/icons'
import { Link, text, type Diagnostic, type GraphInput, type NodeTypeDefinition, type TaskView, type WorkflowDocument } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { formatBytes } from '@/lib/format'
import { videoSource } from '@youdub/sdk/video-source'
import { Input } from '@/components/ui/input'
import { LaunchCard, UploadSlot } from './media-upload'
import { acceptsInputMime, compatibleInputFiles, videoLinkInput, withVideoLink, type InputFile } from './workflow-launch'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/inline-alert'
import { ConfigEditor } from './schema-form'
import { nodeDefinition, workflowPortLabel } from './workflow-utils'
import { WorkflowResources } from './workflow-resources'
import { workflowDiagnostics, WorkflowDiagnostics } from './workflow-errors'

import { useActiveView, useObservableSource, usePendingUnload } from '../view-hooks'
import { StudioDraftStore, type WorkflowRunDraft } from '@/runtime/studio-draft'
export type { WorkflowRunDraft } from '@/runtime/studio-draft'

export function WorkflowRun({ document, types, revision = null, afterInputs, prominent = false, submissionStore, draft, onDraftChange, onStarted, onLockChange, request, navigate, useSlot, useWorkflowResources }: { document: WorkflowDocument; types: NodeTypeDefinition[]; revision?: number | null; afterInputs?: ReactNode; prominent?: boolean; submissionStore?: StudioDraftStore; draft?: WorkflowRunDraft; onDraftChange?: Dispatch<SetStateAction<WorkflowRunDraft>>; onStarted?(): void; onLockChange?(locked: boolean): void } & Bindings<'request' | 'navigate' | 'useSlot' | 'useWorkflowResources'>) {
  const tx = useText(), { language } = useI18n()
  const [localDraft, setLocalDraft] = useState<WorkflowRunDraft>({ selectedFiles: [], sourceUrl: '', runtimeByDocument: {} })
  const { selectedFiles, sourceUrl, proxyPort = 0, runtimeByDocument } = draft ?? localDraft
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
  const imported = linkInput && source ? withVideoLink(document, types, linkInput.id, source.url, proxyPort) : undefined
  const download = imported?.document.nodes[0]
  const proxyField = download && nodeDefinition(download, types)?.configSchema.properties?.proxyPort
  const runDocument = imported?.document ?? document
  const runtime = runtimeByDocument[document.id] ?? {}
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [localError, setError] = useState(''), [validating, setValidating] = useState(false)
  const [localStore] = useState(() => new StudioDraftStore())
  const store = submissionStore ?? localStore
  const submissionKey = `graph:${document.id}`
  const { submissions } = useObservableSource(store)
  const submission = submissions[submissionKey]
  const busy = validating || !!submission?.busy, pending = submission?.id ?? '', error = submission?.error || localError
  const activeView = useActiveView()
  function openTask(task: TaskView) {
    if (!activeView.current) return
    store.clearSubmission(submissionKey); onStarted?.(); navigate(`/tasks/${task.id}`)
  }
  const activeRuntime = Object.fromEntries(document.nodes.filter((node) => runtime[node.id]).map((node) => [node.id, runtime[node.id]]))
  const runRuntime = { ...activeRuntime, ...imported?.runtime }
  const resources = useWorkflowResources(runDocument)
  const complete = !linkError && document.inputs.every((input) => !input.required || files[input.id] || (input.id === linkInput?.id && source))
  const locked = busy || !!pending
  usePendingUnload(locked)
  useEffect(() => { onLockChange?.(locked) }, [locked, onLockChange])
  async function run() {
    if (locked || !complete || !resources.ready) return
    setValidating(true); setError(''); setDiagnostics([])
    try {
      const validation = await request<{ valid: boolean; diagnostics: Diagnostic[] }>('/api/v2/workflow-documents/validate', { method: 'POST', body: JSON.stringify({ document: runDocument, nodeRuntimeInputs: runRuntime }) })
      if (!activeView.current) return
      setDiagnostics(validation.diagnostics)
      if (!validation.valid) return
      const id = crypto.randomUUID()
      const body = new FormData()
      body.set('request', JSON.stringify({ id, workflowId: 'youdub.graph', workflowVersion: '1.0.0', graphDocument: runDocument, nodeRuntimeInputs: runRuntime, config: {}, documentRevision: imported ? null : revision, ...(source ? { sourceName: source.url } : {}) }))
      Object.entries(files).filter(([name]) => !imported || name !== linkInput?.id).forEach(([name, file]) => body.set(`input.${name}`, file))
      const task = await store.submit(submissionKey, request, body)
      if (task) openTask(task)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure)); setDiagnostics(workflowDiagnostics(failure))
    } finally { if (activeView.current) setValidating(false) }
  }
  function changeFile(input: GraphInput, file?: File) {
    const next = document.inputs.filter((item) => item.id !== input.id && files[item.id]).map((item) => ({ input: item, file: files[item.id] }))
    if (file && !acceptsInputMime(input, file)) {
      setFiles(next)
      setError(tx("workflow.run.value.is.not.a.supported.file.type", { value1: file.name }))
      return
    }
    if (file && file.size > input.maxBytes) {
      setFiles(next)
      setError(tx("workflow.run.value.exceeds.the.value.limit", { value1: file.name, value2: formatBytes(input.maxBytes) }))
      return
    }
    if (file) next.push({ input, file })
    if (file && input.id === linkInput?.id) { setSourceUrl(''); setLinkTouched(false) }
    setFiles(next); setError('')
  }
  const material = <div>
    {linkInput && <div className="pt-3 pb-1">
      <div className="flex min-w-0 items-center gap-2">
        <Input icon={<Link2 className="size-4" />} aria-label={tx("workflow.run.video.link")} inputMode="url" autoComplete="off" value={sourceUrl} disabled={locked} placeholder={tx("workflow.run.paste.a.youtube.or.bilibili.link")} className="flex-1" onBlur={() => setLinkTouched(true)} onChange={(event) => {
          setSourceUrl(event.target.value); setLinkTouched(false); setError('')
          if (event.target.value) changeFile(linkInput, undefined)
        }} />
        {source && <span className="shrink-0 text-xs text-muted-foreground">{source.platform === 'Bilibili' ? 'B 站' : 'YouTube'}</span>}
        {sourceUrl && <Button variant="ghost" size="icon-sm" disabled={locked} aria-label={tx("workflow.run.clear.link")} onClick={() => { setSourceUrl(''); setLinkTouched(false) }}><X /></Button>}
      </div>
      {linkTouched && linkError && <div className="mt-2"><InlineAlert>{linkError}</InlineAlert></div>}
      {proxyField && <div className="mt-3"><ConfigEditor useSlot={useSlot} ownerId="video-link.download" schema={{ type: 'object', properties: { proxyPort: proxyField } }} value={{ proxyPort }} diagnostics={[]} readOnly={locked} onChange={(config) => setDraft((current) => ({ ...current, proxyPort: config.proxyPort as number | undefined }))} /></div>}
      <div className="my-2 text-center text-xs text-subtle-foreground">{tx("workflow.run.or.upload.a.video")}</div>
    </div>}
    <div className="grid gap-3">{document.inputs.map((input) => <UploadSlot key={input.id} slot={{ ...input, name: input.id, label: workflowPortLabel(document, input, tx) }} file={files[input.id]} disabled={locked} alternative={input.id === linkInput?.id} onChange={(file) => changeFile(input, file)} />)}</div>
    </div>
  const status = <div className="space-y-3">
    {document.nodes.map((node) => { const definition = nodeDefinition(node, types); return definition?.runtimeInputSchema ? <fieldset className="space-y-3" key={node.id}><legend className="mb-2 text-sm font-medium">{node.label || text(definition.label, language)}</legend><ConfigEditor useSlot={useSlot} ownerId={`runtime:${node.type}`} value={runtime[node.id] ?? {}} schema={definition.runtimeInputSchema} diagnostics={[]} readOnly={locked} onChange={(value) => { setDraft((current) => ({ ...current, runtimeByDocument: { ...current.runtimeByDocument, [document.id]: { ...current.runtimeByDocument[document.id], [node.id]: value } } })); setDiagnostics([]) }} /></fieldset> : null })}
    <WorkflowResources resources={resources} types={types} disabled={locked} hideReady={prominent} />
    {error && <InlineAlert>{error}</InlineAlert>}
    <WorkflowDiagnostics diagnostics={submission?.failure ? workflowDiagnostics(submission.failure) : diagnostics} document={runDocument} types={types} />
    {pending && !busy && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{tx("workflow.run.check.whether.the.task.was.created.before.submitting.again")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { void store.check(submissionKey, request).then(task => { if (task) openTask(task) }) }}>{tx("workflow.run.check.created.task")}</Button>
        <Button variant="outline" onClick={() => { void store.discard(submissionKey, request).then(cleared => { if (cleared && activeView.current) { setError(''); setDiagnostics([]) } }) }}>{tx("workflow.run.discard.submission.and.edit")}</Button>
      </div>
    </div>}
  </div>
  const quietResources = resources.ready && resources.result?.status === 'ready' && !resources.checking && !resources.error && !resources.result.error && !resources.result.activePreparation
  const showStatus = !quietResources || error || diagnostics.length > 0 || (pending && !busy) || document.nodes.some((node) => nodeDefinition(node, types)?.runtimeInputSchema)
  const submit = <Button size={prominent ? "xl" : "default"} className={prominent ? "w-full shrink-0 sm:ml-auto sm:w-auto" : undefined} disabled={locked || !complete || !resources.ready} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{prominent ? source ? tx("workflow.run.download.and.process") : tx("workflow.run.start.processing") : tx("workflow.run.start.workflow")}</Button>
  if (prominent) return <div className="space-y-4"><LaunchCard>{material}<div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border px-2 pt-2.5 pb-1"><div className="min-w-0 flex-1">{afterInputs}</div>{submit}</div></LaunchCard>{showStatus ? status : null}</div>
  return <section className="space-y-4">{material}{afterInputs}{status}<div className="flex flex-wrap items-center justify-between gap-3">{!locked && <Link href="/settings/models" className="text-xs text-muted-foreground hover:text-foreground">{tx("workflow.run.connection.settings")}</Link>}{submit}</div></section>
}
