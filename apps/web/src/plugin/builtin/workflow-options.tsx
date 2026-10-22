import type { Bindings, JsonObject, NodeTypeDefinition, WorkflowDocument } from '../sdk'
import { text } from '../sdk'
import { useI18n, useText } from '@/lib/i18n'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { FieldPopover } from '@/components/ui/popover'
import { ChevronDown } from '@/lib/icons'
import { ConfigEditor } from './schema-form'
import { fieldOptions, fieldType, fieldValue, nodeModel } from '@/runtime/schema-fields'
import { nodeDefinition } from './workflow-utils'

export const optionPillClassName = 'inline-flex w-auto max-w-full gap-2'

export function WorkflowOptions({ document, types, disabled, onChange, useSlot }: {
  document: WorkflowDocument; types: NodeTypeDefinition[]; disabled: boolean
  onChange(nodeId: string, config: JsonObject): void
} & Bindings<'useSlot'>) {
  const { language } = useI18n(), tx = useText()
  const fields = document.nodes.flatMap((node) => {
    const definition = nodeDefinition(node, types)
    return (definition?.ui?.quickFields ?? []).flatMap((key) => {
      const field = definition?.configSchema.properties?.[key]
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
    const { options, constrained } = fieldOptions(field, nodeModel(node, definition))
    const value = node.config[key], freeform = !constrained && fieldType(field) !== 'boolean'
    if (freeform) {
      const type = fieldType(field), numeric = type === 'number' || type === 'integer'
      const simple = numeric || type === 'string'
      return <FieldPopover key={`${document.id}:${node.id}:${key}`} disabled={disabled} label={ariaLabel} className={`border items-center outline-none focus-visible:outline-none disabled:opacity-50 ${optionPillClassName}`} trigger={<><span className="text-subtle-foreground">{title}</span><span className="min-w-0 truncate font-medium">{simple ? String(value ?? '—') : tx("workflow.options.configure")}</span><ChevronDown className="size-4 shrink-0 text-subtle-foreground" /></>}>
          {simple ? <Input aria-label={label} disabled={disabled} type={numeric ? 'number' : 'text'} min={field.minimum} max={field.maximum} step={type === 'integer' ? 1 : 'any'} minLength={field.minLength} maxLength={field.maxLength} value={value === undefined || value === null ? '' : String(value)} onChange={(event) => onChange(node.id, { ...node.config, [key]: fieldValue(field, event.target.value) })} /> : <ConfigEditor useSlot={useSlot} ownerId={`quick:${node.type}`} mode="options" schema={{ type: 'object', properties: { [key]: field } }} value={node.config} readOnly={disabled} diagnostics={[]} onChange={(config) => onChange(node.id, { ...node.config, [key]: config[key] })} />}
      </FieldPopover>
    }
    if (value !== undefined && !options.some((option) => option.value === value)) options.unshift({ value, label: `${text(declared.find((item) => item.value === value)?.label ?? String(value), language)} · ${tx("workflow.options.unavailable")}`, disabled: true })
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
