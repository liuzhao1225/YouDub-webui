import { bindComponent, type Bindings } from '../sdk'
import { useText } from '@/lib/i18n'
import { Context } from 'cordis'
import { type EditorProps, type JsonObject } from '../sdk'
import type { Runtime, TaskConfig } from '@/plugin/builtin/localize-contracts'
import { TaskConfigForm, TaskOptions } from '@/components/localize-task-config'
import { InlineAlert } from '@/components/inline-alert'
function LocalizeEditor({ value, readOnly, mode, onChange, useQuery }: EditorProps & Bindings<'useQuery'>) {
  const tx = useText()
  const { data: runtime, error } = useQuery<Runtime>('/api/v2/runtime')
  if (error) return <InlineAlert>{error}</InlineAlert>
  if (!runtime) return <p role="status" className="text-sm text-muted-foreground">{tx("Loading models…", "正在加载模型目录…", "モデルを読み込み中…")}</p>
  const Form = mode === 'options' ? TaskOptions : TaskConfigForm
  return <fieldset disabled={readOnly} className="min-w-0 disabled:opacity-60"><Form value={value as unknown as TaskConfig} runtime={runtime} onChange={(next) => onChange(next as unknown as JsonObject)} /></fieldset>
}
export const name = 'client-localize-editor'
export const inject = ['slots', 'apiClient']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register('config.editors', { id: 'youdub.localize', component: bindComponent(ctx, ['useQuery'], LocalizeEditor) }))
}
