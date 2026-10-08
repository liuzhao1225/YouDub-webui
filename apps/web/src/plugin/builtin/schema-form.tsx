import { useId } from 'react'
import { text, useSlot, type EditorProps, type JsonObject, type JsonSchema } from '../sdk'
import { useI18n } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function schemaProblems(schema: JsonSchema, path = ''): string[] {
  const object = schema as Record<string, unknown>
  if (['oneOf', 'anyOf', 'allOf', '$ref'].some((key) => key in object) || !['object', 'string', 'number', 'integer', 'boolean'].includes(schema.type ?? (schema.enum ? 'string' : 'object'))) return [path || 'config']
  return Object.entries(schema.properties ?? {}).flatMap(([key, child]) => schemaProblems(child, path ? `${path}.${key}` : key))
}
export function defaultConfig(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return structuredClone(schema.default)
  if (schema.type === 'object' || schema.properties) return Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([, child]) => child.default !== undefined || child.type === 'object').map(([key, child]) => [key, defaultConfig(child)]))
  return undefined
}
export function validateConfig(schema: JsonSchema, value: unknown, path = ''): string[] {
  if (schema.type === 'object' || schema.properties) {
    const object = (value ?? {}) as JsonObject
    const missing = (schema.required ?? []).filter((key) => object[key] === undefined || object[key] === null || object[key] === '').map((key) => `${path}${key}`)
    return [...missing, ...Object.entries(schema.properties ?? {}).filter(([key]) => object[key] !== undefined).flatMap(([key, child]) => validateConfig(child, object[key], `${path}${key}.`))]
  }
  if (schema.enum && !schema.enum.includes(value)) return [path.replace(/\.$/, '')]
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return [path.replace(/\.$/, '')]
  return []
}
function Fields({ schema, value, onChange, readOnly, prefix = '' }: EditorProps & { prefix?: string }) {
  const { language } = useI18n()
  const id = useId()
  return <div className="grid gap-5 sm:grid-cols-2">{Object.entries(schema.properties ?? {}).map(([key, field]) => {
    const label = text(field.title, language) || key
    const fieldId = `${id}-${key}`
    if (field.type === 'object' || field.properties) return <fieldset key={key} className="space-y-4 rounded-xl border border-border p-4 sm:col-span-2"><legend className="px-2 text-sm font-medium">{label}</legend><Fields value={(value[key] as JsonObject) ?? {}} schema={field} diagnostics={[]} readOnly={readOnly} prefix={`${prefix}${key}.`} onChange={(next) => onChange({ ...value, [key]: next })} /></fieldset>
    return <div key={key} className="space-y-2"><Label htmlFor={fieldId}>{label}{schema.required?.includes(key) ? ' *' : ''}</Label>{field.enum ? <select id={fieldId} disabled={readOnly} value={value[key] === undefined ? '' : String(value[key])} onChange={(event) => onChange({ ...value, [key]: field.enum!.find((entry) => String(entry) === event.target.value) })} className="h-10 w-full rounded-lg border border-input bg-input-bg px-3 text-sm"><option value="">—</option>{field.enum.map((entry) => <option key={String(entry)} value={String(entry)}>{String(entry)}</option>)}</select> : field.type === 'boolean' ? <div><input id={fieldId} type="checkbox" disabled={readOnly} checked={Boolean(value[key])} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} className="size-4 accent-primary" /></div> : <Input id={fieldId} disabled={readOnly} type={field.type === 'number' || field.type === 'integer' ? 'number' : 'text'} min={field.minimum} max={field.maximum} step={field.type === 'integer' ? 1 : 'any'} required={schema.required?.includes(key)} minLength={field.minLength} maxLength={field.maxLength} value={value[key] === undefined || value[key] === null ? '' : String(value[key])} onChange={(event) => onChange({ ...value, [key]: field.type === 'number' || field.type === 'integer' ? (event.target.value === '' ? undefined : Number(event.target.value)) : event.target.value })} />}{field.description && <p className="text-xs leading-relaxed text-muted-foreground">{text(field.description, language)}</p>}</div>
  })}</div>
}
export function ConfigEditor({ ownerId, ...props }: EditorProps & { ownerId: string }) {
  const editors = useSlot('config.editors')
  const Custom = editors.find((entry) => entry.id === ownerId)?.component
  if (Custom) return <Custom {...props} />
  const unsupported = schemaProblems(props.schema)
  if (unsupported.length) return <p role="alert" className="text-sm text-status-danger-fg">配置需要插件编辑器：{unsupported.join(', ')}</p>
  return <Fields {...props} />
}
export function useEditorSupported(ownerId: string, schema: JsonSchema) {
  return useSlot('config.editors').some((entry) => entry.id === ownerId) || schemaProblems(schema).length === 0
}
