import { type Bindings } from '../sdk'
import { useText } from '@/lib/i18n'
import { type EditorProps, type JsonObject } from '../sdk'
import type { Runtime, TaskConfig } from '@/plugin/builtin/localize-contracts'
import { TaskConfigForm, TaskOptions } from '@/components/localize-task-config'
import { InlineAlert } from '@/components/inline-alert'
export function LocalizeEditor({ value, readOnly, mode, onChange, useQuery }: EditorProps & Bindings<'useQuery'>) {
  const tx = useText()
  const { data: runtime, error } = useQuery<Runtime>('/api/v2/runtime')
  if (error) return <InlineAlert>{error}</InlineAlert>
  if (!runtime) return <p role="status" className="text-sm text-muted-foreground">{tx("localize.editor.loading.models")}</p>
  const Form = mode === 'options' ? TaskOptions : TaskConfigForm
  return <fieldset disabled={readOnly} className="min-w-0 disabled:opacity-60"><Form value={value as unknown as TaskConfig} runtime={runtime} onChange={(next) => onChange(next as unknown as JsonObject)} /></fieldset>
}
