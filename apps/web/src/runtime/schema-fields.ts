import type { GraphNode, JsonSchema, LocalizedText, NodeTypeDefinition } from '@/plugin/contracts'

export function fieldType(schema: JsonSchema) { return Array.isArray(schema.type) ? schema.type.find(type => type !== 'null') : schema.type }
export function fieldValue(schema: JsonSchema, raw: string) {
  const type = fieldType(schema)
  return type === 'number' || type === 'integer' ? raw === '' ? undefined : Number(raw) : raw
}
export function nodeModel(node: GraphNode, definition?: NodeTypeDefinition) {
  return definition?.provider.models?.find(model => typeof model !== 'string' && model.id === node.provider.model) as Record<string, unknown> | undefined
}
export type FieldOption = { value: unknown; label: LocalizedText; disabled?: boolean }
/** Capability absence means unknown support. Only explicit model capabilities constrain choices. */
export function fieldOptions(schema: JsonSchema, model?: Record<string, unknown>): { options: FieldOption[]; constrained: boolean } {
  const declared = schema['x-options'] ?? []
  const supported = schema['x-optionsFrom'] ? model?.[schema['x-optionsFrom']] : undefined
  const values = Array.isArray(supported) ? supported : schema.enum
  if (values) return { options: values.map(value => ({ value, label: declared.find(option => option.value === value)?.label ?? String(value) })), constrained: true }
  if (declared.length) return { options: [...declared], constrained: true }
  if (fieldType(schema) === 'boolean') return { options: [
    { value: true, label: { default: 'On', translations: { zh: '开启', ja: 'オン' } } },
    { value: false, label: { default: 'Off', translations: { zh: '关闭', ja: 'オフ' } } },
  ], constrained: false }
  return { options: [], constrained: false }
}
