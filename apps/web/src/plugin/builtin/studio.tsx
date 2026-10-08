import { Context } from 'cordis'
import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2, Sparkles, Upload } from 'lucide-react'
import { text, useClient, type Catalog, type JsonObject, type TaskView, type WorkflowDescription } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { BrandMark } from '@/components/brand/brand-mark'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useQuery } from './use-query'
import { ConfigEditor, defaultConfig, schemaProblems, useEditorSupported, validateConfig } from './schema-form'

function Composer({ workflow }: { workflow: WorkflowDescription }) {
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
    if (missing.length) { setError(`${tx("Check configuration:", "请检查配置：", "設定を確認：")}${missing.join(', ')}`); return }
    const id = pendingId || crypto.randomUUID()
    const body = new FormData()
    body.append('request', JSON.stringify({ id, workflowId: workflow.id, workflowVersion: workflow.version, config }))
    for (const [name, file] of Object.entries(files)) body.append(`input.${name}`, file)
    setBusy(true); setError(''); setPendingId(id)
    try { const task = await apiClient.request<TaskView>('/api/v2/tasks', { method: 'POST', body }); navigation.push(`/tasks/${task.id}`) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={(event) => void submit(event)} className="space-y-6 rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
    <div className="grid gap-4">{workflow.inputs.map((slot) => <div key={slot.name} className="rounded-xl border border-dashed border-input bg-muted/40 p-5"><Label htmlFor={`input-${slot.name}`} className="mb-3 flex items-center gap-2"><Upload className="size-4" />{text(slot.label, language)}{slot.required ? ' *' : ''}</Label><Input id={`input-${slot.name}`} type="file" disabled={busy || !!pendingId} required={slot.required} accept={slot.acceptedMimeTypes?.join(',')} onChange={(event) => {
      const file = event.target.files?.[0]
      if (file && slot.maxBytes && file.size > slot.maxBytes) { setError(`${text(slot.label, language)} ${tx("exceeds the file size limit", "超过文件大小限制", "はファイルサイズの上限を超えています")}`); event.target.value = ''; setFiles((current) => { const next = { ...current }; delete next[slot.name]; return next }); return }
      setFiles((current) => { const next = { ...current }; if (file) next[slot.name] = file; else delete next[slot.name]; return next })
    }} /></div>)}</div>
    <ConfigEditor ownerId={workflow.id} value={config} schema={workflow.configSchema} diagnostics={[]} readOnly={busy || !!pendingId} onChange={setConfig} />
    {error && <InlineAlert>{error}</InlineAlert>}
    {pendingId && !busy && <div className="space-y-2 text-sm"><p className="break-all text-muted-foreground">{tx("Task ID:", "任务 ID：", "タスク ID：")}{pendingId}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => { void apiClient.request<TaskView>(`/api/v2/tasks/${pendingId}`).then((task) => navigation.push(`/tasks/${task.id}`)).catch((failure: Error) => setError(failure.message)) }}>{tx("Check task status", "查询创建结果", "タスクの状態を確認")}</Button><Button type="button" variant="outline" onClick={() => { setBusy(true); void apiClient.request<void>(`/api/v2/imports/${pendingId}`, { method: 'DELETE' }).then(() => { setPendingId(''); setError('') }).catch((failure: Error) => setError(failure.message)).finally(() => setBusy(false)) }}>{tx("Clear this import", "清理本次导入", "今回のインポートを削除")}</Button></div></div>}
    <Button type="submit" size="xl" className="w-full" disabled={busy || !supported || !requiredFiles}>{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{pendingId ? tx('Submit with the same ID', '使用同一 ID 提交', '同じ ID で送信') : tx('Start processing', '开始处理', '処理を開始')}</Button>
  </form>
}
function Studio() {
  const tx = useText()
  const { data: catalog, error, refresh } = useQuery<Catalog>('/api/v2/catalog')
  const { language, t } = useI18n()
  const [selected, setSelected] = useState('')
  const workflow = catalog?.workflows.find((item) => item.id === selected) ?? catalog?.workflows[0]
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14"><header className="mb-9 text-center"><BrandMark animated className="mx-auto mb-5 h-10" /><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t.studio.heroTitleLead}{language === 'en' ? ' ' : ''}<span className="text-brand-gradient">{t.studio.heroTitleAccent}</span></h1><p className="mt-3 text-sm text-muted-foreground">{t.studio.heroSubtitle}</p></header>{error && <div className="mb-5 space-y-2"><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={refresh}>{tx("Reload", "重新加载", "再読み込み")}</Button></div>}{catalog && !workflow && <InlineAlert>{tx("No workflows are available.", "当前插件组合未提供处理流程。", "利用可能なワークフローがありません。")}</InlineAlert>}{workflow && <><div className="mb-5 flex items-center gap-3"><Label htmlFor="workflow">{tx('Workflow', '处理流程', 'ワークフロー')}</Label><select id="workflow" value={workflow.id} onChange={(event) => setSelected(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-input-bg px-3 text-sm">{catalog!.workflows.map((item) => <option key={item.id} value={item.id}>{text(item.label, language)}</option>)}</select></div><Composer key={`${workflow.id}:${workflow.version}`} workflow={workflow} /></>}</main>
}
export const name = 'client-studio'
export const inject = ['slots', 'apiClient', 'navigation']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('shell.routes', { id: 'studio', path: '/', component: Studio, access: 'authenticated' }))
  ctx.effect(() => ctx.slots.register('shell.navigation', { id: 'studio', routeId: 'studio', label: { default: 'Studio', translations: { zh: '工作台', ja: 'スタジオ' } }, order: 10, icon: Sparkles }))
}
