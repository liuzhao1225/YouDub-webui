import Ajv from 'ajv/dist/2020.js'
import { AppError, type WorkflowDocument, type JsonObject } from '@youdub/sdk'

const text = { type: 'string', minLength: 1, maxLength: 256 }
const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$' }
const object = (properties: JsonObject, required = Object.keys(properties)): JsonObject => ({ type: 'object', properties, required, additionalProperties: false })
const endpoint = object({ nodeId: { type: 'string', pattern: '^(\\$inputs|[a-zA-Z0-9][a-zA-Z0-9._-]{0,127})$' }, portId: id })
const point = object({ x: { type: 'number' }, y: { type: 'number' } })
const schema = object({
  format: { const: 'youdub.workflow' }, formatVersion: { const: 1 }, id, title: text,
  nodes: { type: 'array', maxItems: 128, items: object({ id, type: id, typeVersion: text, label: text, provider: object({ id, model: text, device: text }, ['id']), config: { type: 'object', maxProperties: 64 }, autoContinue: { type: 'boolean' } }, ['id', 'type', 'typeVersion', 'provider', 'config', 'autoContinue']) },
  edges: { type: 'array', maxItems: 1024, items: object({ id, source: endpoint, target: endpoint }) },
  inputs: { type: 'array', maxItems: 16, items: object({ id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' }, label: text, required: { type: 'boolean' }, kind: { const: 'artifact' }, schemaId: text, acceptedMimeTypes: { type: 'array', minItems: 1, maxItems: 16, items: text }, maxBytes: { type: 'integer', minimum: 1, maximum: 4294967296 } }) },
  outputs: { type: 'array', maxItems: 64, items: object({ id, label: text, kind: { const: 'artifact' }, schemaId: text, required: { type: 'boolean' }, source: endpoint }) },
  presentation: object({ positions: { type: 'object', maxProperties: 130, additionalProperties: point }, viewport: object({ x: { type: 'number' }, y: { type: 'number' }, zoom: { type: 'number', minimum: 0.05, maximum: 8 } }) }),
})
const ajv = new Ajv({ strict: false, allErrors: true })
const check = ajv.compile(schema)
export function parseWorkflowDocument(value: unknown): WorkflowDocument {
  if (JSON.stringify(value)?.length > 1024 * 1024) throw new AppError('INVALID_WORKFLOW', 'Workflow document exceeds 1 MiB.', 422)
  if (!check(value)) throw new AppError('INVALID_WORKFLOW', ajv.errorsText(check.errors), 422, check.errors)
  const document = value as WorkflowDocument
  for (const [field, items] of Object.entries({ nodes: document.nodes, edges: document.edges, inputs: document.inputs, outputs: document.outputs })) {
    if (new Set(items.map(item => item.id)).size !== items.length) throw new AppError('INVALID_WORKFLOW', `${field} IDs must be unique.`, 422)
  }
  // Shareable documents never store credentials, local paths, or per-run source URLs.
  const scan = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (/(?:api[_-]?key|password|credential|authorization|secret|token|cookie|^path$|^url$|source_url)/i.test(key) && key !== 'maxCompletionTokens') throw new AppError('PRIVATE_WORKFLOW_DATA', `Workflow configuration cannot contain ${key}.`, 422)
      scan(item)
    }
  }
  for (const node of document.nodes) scan(node.config)
  return structuredClone(document)
}
