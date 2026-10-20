import type { Endpoint, GraphNode, NodeTypeDefinition, WorkflowDocument } from '../contracts'
import { text } from '../sdk'

export const INPUTS_ID = '$inputs', OUTPUTS_ID = '$outputs'
export function nodeDefinition(node: GraphNode, types: NodeTypeDefinition[]) {
  return types.find((type) => type.type === node.type && type.version === node.typeVersion && type.providerId === node.provider.id)
}
export function sources(document: WorkflowDocument, types: NodeTypeDefinition[], language = 'en') {
  return [
    ...document.inputs.map((input) => ({ source: { nodeId: INPUTS_ID, portId: input.id }, label: input.label, kind: input.kind, schemaId: input.schemaId })),
    ...document.nodes.flatMap((node) => {
      const definition = nodeDefinition(node, types)
      const repeated = !node.label && document.nodes.filter((item) => item.type === node.type && !item.label).length > 1
      const label = node.label || `${text(definition?.label, language) || node.type}${repeated ? ` (${node.id.slice(0, 8)})` : ''}`
      return (definition?.outputs ?? []).map((port) => ({ source: { nodeId: node.id, portId: port.name }, label: `${label} · ${text(port.label, language) || port.name}`, kind: port.kind, schemaId: port.schemaId }))
    }),
  ]
}
export function endpointKey(endpoint: Endpoint) { return JSON.stringify([endpoint.nodeId, endpoint.portId]) }
export function canConnect(document: WorkflowDocument, types: NodeTypeDefinition[], source: Endpoint, target: Endpoint) {
  if (source.nodeId === target.nodeId || target.nodeId === INPUTS_ID || source.nodeId === OUTPUTS_ID) return false
  const output = sources(document, types).find((item) => endpointKey(item.source) === endpointKey(source))
  if (!output) return false
  if (target.nodeId === OUTPUTS_ID) return output.kind === 'artifact' && document.outputs.some((port) => port.id === target.portId && port.schemaId === output.schemaId)
  const node = document.nodes.find((item) => item.id === target.nodeId)
  const input = node && nodeDefinition(node, types)?.inputs.find((item) => item.id === target.portId)
  if (!input || input.kind !== output.kind || !input.acceptedSchemaIds.includes(output.schemaId)) return false
  // Replacing the selected input is allowed. The replacement must remain acyclic.
  const edges = document.edges.filter((edge) => endpointKey(edge.target) !== endpointKey(target))
  const visit = (id: string, seen = new Set<string>()): boolean => {
    if (id === source.nodeId) return true
    if (seen.has(id)) return false
    seen.add(id)
    return edges.some((edge) => edge.source.nodeId === id && visit(edge.target.nodeId, seen))
  }
  return !visit(target.nodeId)
}
export function connect(document: WorkflowDocument, source: Endpoint, target: Endpoint): WorkflowDocument {
  if (target.nodeId === OUTPUTS_ID) return { ...document, outputs: document.outputs.map((port) => port.id === target.portId ? { ...port, source } : port) }
  return { ...document, edges: [...document.edges.filter((edge) => endpointKey(edge.target) !== endpointKey(target)), { id: crypto.randomUUID(), source, target }] }
}
export function removeNodes(document: WorkflowDocument, ids: string[]) {
  return { ...document, nodes: document.nodes.filter((node) => !ids.includes(node.id)), edges: document.edges.filter((edge) => !ids.includes(edge.source.nodeId) && !ids.includes(edge.target.nodeId)), outputs: document.outputs.filter((port) => !ids.includes(port.source.nodeId)) }
}
export function blankWorkflow(): WorkflowDocument {
  return { format: 'youdub.workflow', formatVersion: 1, id: crypto.randomUUID(), title: '', nodes: [], edges: [], inputs: [], outputs: [], presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } } }
}
export function parseWorkflow(raw: string): WorkflowDocument {
  const value = JSON.parse(raw) as WorkflowDocument
  if (value?.format !== 'youdub.workflow' || value.formatVersion !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.inputs) || !Array.isArray(value.outputs) || !value.presentation?.positions || !value.presentation.viewport) throw new Error('Unsupported workflow file. Expected youdub.workflow version 1.')
  return value
}
// Browser memory retains a draft while opening its dedicated node page. It is
// not persisted as a saved workflow and contains neither uploads nor secrets.
export const workflowDrafts = new Map<string, { document: WorkflowDocument; saved: string; revision: number; origin: string }>()
