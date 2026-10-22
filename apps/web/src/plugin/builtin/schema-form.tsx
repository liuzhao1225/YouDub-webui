import { NativeSelect, Choice } from '@/components/ui/native-select'
import type { Bindings } from '../sdk'
import { useId } from 'react'
import { text, type EditorProps, type JsonObject, type JsonSchema } from '../sdk'
import { fieldOptions, fieldType, fieldValue } from '@/runtime/schema-fields'
export { fieldType } from '@/runtime/schema-fields'
import { useI18n, useText } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function schemaProblems(schema: JsonSchema, path = ''): string[] {
  const object = schema as Record<string, unknown>
  if (['oneOf', 'anyOf', 'allOf', '$ref'].some((key) => key in object) || !['object', 'string', 'number', 'integer', 'boolean'].includes(fieldType(schema) ?? (schema.enum ? 'string' : 'object'))) return [path || 'config']
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
function Fields({ schema, value, onChange, readOnly, prefix = '', model }: EditorProps & { prefix?: string; model?: Record<string, unknown> }) {
  const { language } = useI18n(), tx = useText()
  const id = useId()
  return <div className="grid gap-4 @min-[640px]/page:grid-cols-2">{Object.entries(schema.properties ?? {}).map(([key, field]) => {
    const label = text(field['x-title'] ?? field.title, language) || key
    const fieldId = `${id}-${key}`, type = fieldType(field)
    const { options, constrained } = fieldOptions(field, model)
    if (constrained && value[key] !== undefined && !options.some(option => option.value === value[key])) options.unshift({ value: value[key], label: `${String(value[key])} · ${tx("schema.form.unavailable")}`, disabled: true })
    if (type === 'object' || field.properties) return <fieldset key={key} className="space-y-4 rounded-xl border border-border p-4 @min-[640px]/page:col-span-2"><legend className="px-2 text-sm font-medium">{label}</legend><Fields value={(value[key] as JsonObject) ?? {}} schema={field} diagnostics={[]} readOnly={readOnly} prefix={`${prefix}${key}.`} model={model} onChange={(next) => onChange({ ...value, [key]: next })} /></fieldset>
    return <div key={key} className="space-y-2">{type !== 'boolean' && <Label htmlFor={fieldId}>{label}{schema.required?.includes(key) ? ' *' : ''}</Label>}{constrained ? <NativeSelect id={fieldId} disabled={readOnly} value={value[key] === undefined ? '' : String(value[key])} onChange={(event) => onChange({ ...value, [key]: options.find(option => String(option.value) === event.target.value)?.value })} className="w-full"><option value="">—</option>{options.map(option => <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>{text(option.label, language)}</option>)}</NativeSelect> : type === 'boolean' ? <div><Choice label={label} aria-label={label} disabled={readOnly} checked={Boolean(value[key])} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} className="flex items-center gap-2 text-sm" /></div> : <Input id={fieldId} disabled={readOnly} type={type === 'number' || type === 'integer' ? 'number' : 'text'} min={field.minimum} max={field.maximum} step={type === 'integer' ? 1 : 'any'} required={schema.required?.includes(key)} minLength={field.minLength} maxLength={field.maxLength} value={value[key] === undefined || value[key] === null ? '' : String(value[key])} onChange={(event) => onChange({ ...value, [key]: fieldValue(field, event.target.value) })} />}{field.description && <p className="text-xs leading-relaxed text-muted-foreground">{text(field.description, language)}</p>}</div>
  })}</div>
}
export function ConfigEditor({ ownerId, useSlot, ...props }: EditorProps & { ownerId: string; model?: Record<string, unknown> } & Bindings<'useSlot'>) {
  const editors = useSlot('config.editors')
  const Custom = editors.find((entry) => entry.id === ownerId)?.component
  if (Custom) return <Custom {...props} />
  const unsupported = schemaProblems(props.schema)
  if (unsupported.length) return <p role="alert" className="text-sm text-status-danger-fg">配置需要插件编辑器：{unsupported.join(', ')}</p>
  return <Fields {...props} />
}
export function useEditorSupported(useSlot: Bindings<'useSlot'>['useSlot'], ownerId: string, schema: JsonSchema) {
  return useSlot('config.editors').some((entry) => entry.id === ownerId) || schemaProblems(schema).length === 0
}
