import { useText } from '@/lib/i18n'
import { Context } from 'cordis'
import type { EditorProps, JsonObject } from '../sdk'
import type { Runtime, TaskConfig } from '@/plugin/builtin/localize-contracts'
import { TaskConfigForm } from '@/components/localize-task-config'
import { InlineAlert } from '@/components/inline-alert'
import { useQuery } from './use-query'
function LocalizeEditor({ value, readOnly, onChange }: EditorProps) {
  const tx = useText()
  const { data: runtime, error } = useQuery<Runtime>('/api/v2/runtime')
  if (error) return <InlineAlert>{error}</InlineAlert>
  if (!runtime) return <p role="status" className="text-sm text-muted-foreground">{tx("Loading models…", "正在加载模型目录…", "モデルを読み込み中…")}</p>
  return <fieldset disabled={readOnly} className="disabled:opacity-60"><TaskConfigForm value={value as unknown as TaskConfig} runtime={runtime} onChange={(next) => onChange(next as unknown as JsonObject)} /></fieldset>
}
export const name = 'client-localize-editor'
export const inject = ['slots', 'apiClient']
export function apply(ctx: Context) { ctx.effect(() => ctx.slots.register('config.editors', { id: 'youdub.localize', component: LocalizeEditor })) }
