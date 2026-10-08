import { useText } from '@/lib/i18n'
import { Context } from 'cordis'
import type { Catalog, EditorProps, JsonObject } from '../sdk'
import type { Runtime, TaskConfig, Capability } from '@/plugin/builtin/localize-contracts'
import { TaskConfigForm } from '@/components/localize-task-config'
import { InlineAlert } from '@/components/inline-alert'
import { useQuery } from './use-query'
function LocalizeEditor({ value, readOnly, onChange }: EditorProps) {
  const tx = useText()
  const { data: runtime, error } = useQuery<Runtime>('/api/v2/runtime')
  const { data: catalog, error: catalogError } = useQuery<Catalog>('/api/v2/catalog')
  if (error || catalogError) return <InlineAlert>{error || catalogError}</InlineAlert>
  if (!runtime || !catalog) return <p role="status" className="text-sm text-muted-foreground">{tx("Loading models…", "正在加载模型目录…", "モデルを読み込み中…")}</p>
  const capabilities = catalog.providers.filter((provider) => provider.capability && provider.adapter).map((provider) => ({ ...provider, capability: provider.capability, adapter: provider.adapter, unavailable_reason: provider.unavailableReason ?? null })) as unknown as Capability[]
  return <fieldset disabled={readOnly} className="disabled:opacity-60"><TaskConfigForm value={value as unknown as TaskConfig} runtime={{ ...runtime, capabilities }} onChange={(next) => onChange(next as unknown as JsonObject)} /></fieldset>
}
export const name = 'client-localize-editor'
export const inject = ['slots', 'apiClient']
export function apply(ctx: Context) { ctx.effect(() => ctx.slots.register('config.editors', { id: 'youdub.localize', component: LocalizeEditor })) }
