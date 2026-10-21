import type { GraphInput, JsonObject, NodeTypeDefinition, WorkflowDocument } from '../contracts'
import { nodeDefinition } from './workflow-utils'

export type InputFile = { input: GraphInput; file: File }
export function acceptsInputMime(input: GraphInput, file: File) {
  return !file.type || !input.acceptedMimeTypes.length || input.acceptedMimeTypes.some((mime) => mime === '*/*' || mime === file.type || (mime.endsWith('/*') && file.type.startsWith(mime.slice(0, -1))))
}
export function compatibleInputFiles(previous: InputFile[], inputs: GraphInput[]): Record<string, File> {
  const available = [...previous], result: Record<string, File> = {}
  for (const exact of [true, false]) {
    for (const input of inputs.filter((item) => !result[item.id])) {
      const index = available.findIndex((entry) => (!exact || entry.input.id === input.id) && entry.input.schemaId === input.schemaId && entry.file.size <= input.maxBytes && acceptsInputMime(input, entry.file))
      if (index >= 0) result[input.id] = available.splice(index, 1)[0].file
    }
  }
  return result
}
function downloadForInput(document: WorkflowDocument, types: NodeTypeDefinition[], input: GraphInput) {
  const isSource = (source: { nodeId: string; portId: string }) => source.nodeId === '$inputs' && source.portId === input.id
  for (const definition of types.filter((type) => type.type === 'youdub.download')) {
    const output = definition.outputs.find((port) => port.kind === 'artifact' && document.edges.filter((edge) => isSource(edge.source)).every((edge) => {
      const node = document.nodes.find((item) => item.id === edge.target.nodeId)
      const target = node && nodeDefinition(node, types)?.inputs.find((item) => item.id === edge.target.portId)
      return target?.kind === 'artifact' && target.acceptedSchemaIds.includes(port.schemaId)
    }) && document.outputs.filter((item) => isSource(item.source)).every((item) => item.schemaId === port.schemaId))
    if (output) return { definition, output }
  }
}
export function videoLinkInput(document: WorkflowDocument, types: NodeTypeDefinition[]) {
  const videoInputs = document.inputs.filter((input) => input.acceptedMimeTypes.some((mime) => mime.startsWith('video/')))
  const input = videoInputs.length === 1 ? videoInputs[0] : undefined
  return input && downloadForInput(document, types, input) ? input : undefined
}
export function withVideoLink(document: WorkflowDocument, types: NodeTypeDefinition[], inputId: string, url: string): { document: WorkflowDocument; runtime: Record<string, JsonObject> } {
  const input = document.inputs.find((item) => item.id === inputId)
  const { definition, output } = input && downloadForInput(document, types, input) || {}
  if (!input || !definition || !output) throw new Error('The workflow cannot import this video link.')
  let id = 'source-download'
  while (document.nodes.some((node) => node.id === id)) id += '-1'
  const source = (endpoint: { nodeId: string; portId: string }) => endpoint.nodeId === '$inputs' && endpoint.portId === inputId ? { nodeId: id, portId: output.name } : endpoint
  return {
    document: {
      ...document, inputs: document.inputs.filter((item) => item.id !== inputId),
      nodes: [{ id, type: definition.type, typeVersion: definition.version, provider: { id: definition.providerId }, config: structuredClone(definition.defaults), autoContinue: true }, ...document.nodes],
      edges: document.edges.map((edge) => ({ ...edge, source: source(edge.source) })),
      outputs: document.outputs.map((item) => ({ ...item, source: source(item.source) })),
      presentation: { ...document.presentation, positions: { ...document.presentation.positions, [id]: { x: 0, y: 0 } } },
    }, runtime: { [id]: { url } },
  }
}
