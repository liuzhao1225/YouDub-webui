import { useText } from '@/lib/i18n'
import { useState, type FormEvent } from 'react'
import { Context } from 'cordis'
import { Check, Loader2 } from 'lucide-react'
import { useClient, type Catalog, type EditorProps, type JsonObject } from '../sdk'
import type { Runtime, TaskConfig } from '@/plugin/builtin/localize-contracts'
import { initialTaskConfig, TaskConfigForm, TaskOptions } from '@/components/localize-task-config'
import { InlineAlert } from '@/components/inline-alert'
import { Button } from '@/components/ui/button'
import { useQuery } from './use-query'
function LocalizeEditor({ value, readOnly, mode, onChange }: EditorProps) {
  const tx = useText()
  const { data: runtime, error } = useQuery<Runtime>('/api/v2/runtime')
  if (error) return <InlineAlert>{error}</InlineAlert>
  if (!runtime) return <p role="status" className="text-sm text-muted-foreground">{tx("Loading models…", "正在加载模型目录…", "モデルを読み込み中…")}</p>
  const Form = mode === 'options' ? TaskOptions : TaskConfigForm
  return <fieldset disabled={readOnly} className="min-w-0 disabled:opacity-60"><Form value={value as unknown as TaskConfig} runtime={runtime} onChange={(next) => onChange(next as unknown as JsonObject)} /></fieldset>
}

function DefaultsForm({ defaults, runtime }: { defaults?: Partial<TaskConfig>; runtime: Runtime }) {
  const tx = useText()
  const { apiClient } = useClient()
  const [value, setValue] = useState(() => initialTaskConfig(runtime, defaults))
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('')
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setSaved(false); setError('')
    try {
      await apiClient.request('/api/v2/settings', { method: 'PATCH', body: JSON.stringify({ defaults: value }) })
      setSaved(true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={(event) => void save(event)} className="p-6">
    <p className="text-sm text-muted-foreground">{tx('Used for new tasks. Output and languages can be changed on the home page.', '用于新任务，输出和语言可在主页单独选择。', '新しいタスクに適用します。出力と言語はホームでも変更できます。')}</p>
    <fieldset disabled={busy} className="min-w-0 disabled:opacity-60"><TaskConfigForm value={value} runtime={runtime} onChange={(next) => { setValue(next); setSaved(false) }} /></fieldset>
    {error && <InlineAlert>{error}</InlineAlert>}
    <Button type="submit" className="mt-4" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}{saved ? tx('Saved', '已保存', '保存済み') : tx('Save defaults', '保存默认配置', '初期設定を保存')}</Button>
  </form>
}

function LocalizeSettings() {
  const tx = useText()
  const { data: runtime, error: runtimeError, refresh: refreshRuntime } = useQuery<Runtime>('/api/v2/runtime')
  const { data: catalog, error: catalogError, refresh: refreshCatalog } = useQuery<Catalog>('/api/v2/catalog')
  const workflow = catalog?.workflows.find((item) => item.id === 'youdub.localize')
  const error = runtimeError || catalogError
  return <section className="rounded-2xl border border-border bg-card shadow-card">
    <h2 className="border-b border-border px-6 py-4 font-semibold">{tx('Processing defaults', '默认处理配置', '処理の初期設定')}</h2>
    {error ? <div className="space-y-3 p-6"><InlineAlert>{error}</InlineAlert><Button variant="outline" onClick={() => { refreshRuntime(); refreshCatalog() }}>{tx('Reload', '重新加载', '再読み込み')}</Button></div>
      : runtime && workflow ? <DefaultsForm defaults={workflow.defaults as Partial<TaskConfig>} runtime={runtime} />
        : <p role="status" className="p-6 text-sm text-muted-foreground">{tx('Loading configuration…', '正在加载配置…', '設定を読み込み中…')}</p>}
  </section>
}
export const name = 'client-localize-editor'
export const inject = ['slots', 'apiClient']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('config.editors', { id: 'youdub.localize', component: LocalizeEditor }))
  ctx.effect(() => ctx.slots.register('settings.sections', { id: 'youdub.localize', component: LocalizeSettings }))
}
