import type { Bindings, JsonObject, JsonSchema, LocalizedText, NodeTypeDefinition, WorkflowDocument } from '../sdk'
import { text } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Popover } from '@base-ui/react/popover'
import { ChevronDown } from 'lucide-react'
import { ConfigEditor, fieldType } from './schema-form'
import { nodeDefinition } from './workflow-utils'

export const optionPillClassName = 'inline-flex h-8 w-auto max-w-full gap-1.5 rounded-full border-border bg-muted px-3 text-[13px] shadow-none hover:bg-accent'
type QuickField = JsonSchema & { 'x-options'?: { value: unknown; label: LocalizedText }[]; 'x-optionsFrom'?: string; 'x-short-title'?: LocalizedText }
type QuickOption = { value: unknown; label: LocalizedText; disabled?: boolean }

export function WorkflowOptions({ document, types, disabled, onChange, useSlot }: {
  document: WorkflowDocument; types: NodeTypeDefinition[]; disabled: boolean
  onChange(nodeId: string, config: JsonObject): void
} & Bindings<'useSlot'>) {
  const { language } = useI18n(), tx = useText()
  const fields = document.nodes.flatMap((node) => {
    const definition = nodeDefinition(node, types)
    return (definition?.ui?.quickFields ?? []).flatMap((key) => {
      const field = definition?.configSchema.properties?.[key] as QuickField | undefined
      return field ? [{ node, definition, key, field }] : []
    })
  })
  return <>{fields.map(({ node, definition, key, field }) => {
    const label = text(field['x-title'] ?? field.title, language) || key
    const shortLabel = text(field['x-short-title'], language) || label
    const rawNodeTitle = node.label || text(definition?.label, language) || node.type
    const sameLabels = fields.filter((item) => (text(item.field['x-short-title'], language) || text(item.field['x-title'] ?? item.field.title, language) || item.key) === shortLabel)
    const duplicates = sameLabels.filter((item) => (item.node.label || text(item.definition?.label, language) || item.node.type) === rawNodeTitle)
    const nodeTitle = `${rawNodeTitle}${duplicates.length > 1 ? ` · ${duplicates.findIndex((item) => item.node.id === node.id && item.key === key) + 1}` : ''}`
    const title = sameLabels.length > 1 ? `${nodeTitle} · ${shortLabel}` : shortLabel
    const ariaLabel = fields.filter((item) => (text(item.field['x-title'] ?? item.field.title, language) || item.key) === label).length > 1 ? `${nodeTitle} · ${label}` : label
    const declared = field['x-options'] ?? []
    const model = definition?.provider.models?.find((item) => typeof item !== 'string' && item.id === node.provider.model) as Record<string, unknown> | undefined
    const modelOptions = field['x-optionsFrom'] && model?.[field['x-optionsFrom']]
    const options: QuickOption[] = Array.isArray(modelOptions) ? modelOptions.map((value) => ({ value, label: declared.find((item) => item.value === value)?.label ?? String(value) }))
      : field['x-optionsFrom'] && definition?.provider.capability ? []
      : field.enum ? field.enum.map((value) => ({ value, label: declared.find((item) => item.value === value)?.label ?? String(value) }))
      : declared.length ? [...declared] : field.type === 'boolean' ? [{ value: true, label: tx('On', '开启', 'オン') }, { value: false, label: tx('Off', '关闭', 'オフ') }] : []
    const value = node.config[key], freeform = !options.length && !field.enum && !declared.length && field.type !== 'boolean'
    if (freeform) {
      const type = fieldType(field), numeric = type === 'number' || type === 'integer'
      const simple = numeric || type === 'string'
      return <Popover.Root key={`${document.id}:${node.id}:${key}`}>
        <Popover.Trigger disabled={disabled} aria-label={ariaLabel} className={`border items-center outline-none focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50 ${optionPillClassName}`}><span className="text-subtle-foreground">{title}</span><span className="min-w-0 truncate font-medium">{simple ? String(value ?? '—') : tx('Configure', '设置', '設定')}</span><ChevronDown className="size-4 shrink-0 text-subtle-foreground" /></Popover.Trigger>
        <Popover.Portal><Popover.Positioner sideOffset={6} align="start" className="z-[60]"><Popover.Popup aria-label={ariaLabel} className="w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-elevated p-3 text-popover-foreground shadow-float outline-none">
          {simple ? <Input aria-label={label} autoFocus disabled={disabled} type={numeric ? 'number' : 'text'} min={field.minimum} max={field.maximum} step={type === 'integer' ? 1 : 'any'} minLength={field.minLength} maxLength={field.maxLength} value={value === undefined || value === null ? '' : String(value)} onChange={(event) => onChange(node.id, { ...node.config, [key]: numeric ? event.target.value === '' ? undefined : Number(event.target.value) : event.target.value })} /> : <ConfigEditor useSlot={useSlot} ownerId={`quick:${node.type}`} mode="options" schema={{ type: 'object', properties: { [key]: field } }} value={node.config} readOnly={disabled} diagnostics={[]} onChange={(config) => onChange(node.id, { ...node.config, [key]: config[key] })} />}
        </Popover.Popup></Popover.Positioner></Popover.Portal>
      </Popover.Root>
    }
    if (value !== undefined && !options.some((option) => option.value === value)) options.unshift({ value, label: `${text(declared.find((item) => item.value === value)?.label ?? String(value), language)} · ${tx('Unavailable', '不可用', '利用不可')}`, disabled: true })
    if (!options.length) return null
    const display = options.find((option) => option.value === value)
    return <Select key={`${document.id}:${node.id}:${key}`} value={value === undefined ? '' : JSON.stringify(value)} onValueChange={(next) => {
      const option = options.find((item) => JSON.stringify(item.value) === next)
      if (option && !option.disabled) onChange(node.id, { ...node.config, [key]: option.value })
    }}>
      <SelectTrigger aria-label={ariaLabel} disabled={disabled} className={optionPillClassName}><span className="text-subtle-foreground">{title}</span><span className="min-w-0 truncate font-medium">{display ? text(display.label, language) : '—'}</span></SelectTrigger>
      <SelectContent>{options.map((option) => <SelectItem key={JSON.stringify(option.value)} value={JSON.stringify(option.value)} disabled={option.disabled}>{text(option.label, language)}</SelectItem>)}</SelectContent>
    </Select>
  })}</>
}
