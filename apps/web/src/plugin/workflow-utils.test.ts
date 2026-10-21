import { describe, expect, it } from 'vitest'
import type { NodeTypeDefinition, WorkflowDocument } from './contracts'
import { canConnect, connect, endpointKey, parseWorkflow, removeNodes, serializeWorkflowEdits } from './builtin/workflow-utils'

const type: NodeTypeDefinition = {
  type: 'audio.process', version: '1', providerId: 'test', operation: 'audio.process',
  label: 'Audio', category: 'audio', provider: { id: 'test', operations: [] },
  inputs: [{ id: 'audio', label: 'Audio', kind: 'artifact', acceptedSchemaIds: ['audio/wav/v1'], required: true }],
  outputs: [{ name: 'audio', kind: 'artifact', schemaId: 'audio/wav/v1', required: true }, { name: 'info', kind: 'json', schemaId: 'info/v1', required: true }],
  configSchema: {}, defaults: {},
}
function graph(): WorkflowDocument {
  return { format: 'youdub.workflow', formatVersion: 1, id: 'test', title: 'Test', inputs: [{ id: 'source', label: 'Audio', kind: 'artifact', schemaId: 'audio/wav/v1', required: true, acceptedMimeTypes: ['audio/*'], maxBytes: 100 }], nodes: ['a', 'b', 'c'].map((id) => ({ id, type: type.type, typeVersion: type.version, provider: { id: 'test' }, config: {}, autoContinue: true })), edges: [{ id: 'ab', source: { nodeId: 'a', portId: 'audio' }, target: { nodeId: 'b', portId: 'audio' } }, { id: 'bc', source: { nodeId: 'b', portId: 'audio' }, target: { nodeId: 'c', portId: 'audio' } }], outputs: [{ id: 'result', label: 'Audio', kind: 'artifact', schemaId: 'audio/wav/v1', required: true, source: { nodeId: 'c', portId: 'audio' } }], presentation: { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } } }
}
describe('workflow connections', () => {
  it('rejects cycles, self-links and incompatible JSON ports before changing the graph', () => {
    const document = graph()
    expect(canConnect(document, [type], { nodeId: 'c', portId: 'audio' }, { nodeId: 'a', portId: 'audio' })).toBe(false)
    expect(canConnect(document, [type], { nodeId: 'a', portId: 'audio' }, { nodeId: 'a', portId: 'audio' })).toBe(false)
    expect(canConnect(document, [type], { nodeId: 'a', portId: 'info' }, { nodeId: 'b', portId: 'audio' })).toBe(false)
    expect(canConnect(document, [type], { nodeId: '$inputs', portId: 'source' }, { nodeId: 'a', portId: 'audio' })).toBe(true)
  })
  it('replaces only the selected input while preserving output fan-out', () => {
    const document = graph(), source = { nodeId: 'a', portId: 'audio' }, target = { nodeId: 'c', portId: 'audio' }
    expect(canConnect(document, [type], source, target)).toBe(true)
    const next = connect(document, source, target)
    expect(next.edges.filter((edge) => endpointKey(edge.source) === endpointKey(source))).toHaveLength(2)
    expect(next.edges.filter((edge) => endpointKey(edge.target) === endpointKey(target))).toHaveLength(1)
    expect(document.edges[1].source.nodeId).toBe('b')
  })
  it('updates a final output without adding an execution edge', () => {
    const next = connect(graph(), { nodeId: 'b', portId: 'audio' }, { nodeId: '$outputs', portId: 'result' })
    expect(next.edges).toHaveLength(2)
    expect(next.outputs[0].source.nodeId).toBe('b')
  })
  it('removes references to a deleted node while preserving unrelated branches', () => {
    const next = removeNodes(graph(), ['c'])
    expect(next.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(next.edges.map((edge) => edge.id)).toEqual(['ab'])
    expect(next.outputs).toEqual([])
  })
  it('rejects ComfyUI documents and future incompatible format versions', () => {
    expect(() => parseWorkflow('{"nodes":[],"links":[]}')).toThrow('Unsupported')
    expect(() => parseWorkflow(JSON.stringify({ ...graph(), formatVersion: 2 }))).toThrow('Unsupported')
    expect(parseWorkflow(JSON.stringify(graph()))).toEqual(graph())
  })
})

describe('workflow unsaved changes', () => {
  it('ignores canvas navigation and retains the viewport for saving and node-page drafts', () => {
    const document = graph(), saved = serializeWorkflowEdits(document)
    document.presentation.viewport = { x: 154.5, y: -89, zoom: 0.45 }
    const draft = parseWorkflow(JSON.stringify(document))
    expect(serializeWorkflowEdits(draft)).toBe(saved)
    expect(draft.presentation.viewport).toEqual({ x: 154.5, y: -89, zoom: 0.45 })
  })

  const edits: [string, (document: WorkflowDocument) => void][] = [
    ['name', (document) => { document.title = 'Renamed' }],
    ['parameters', (document) => { document.nodes[0].config.language = 'ja' }],
    ['provider', (document) => { document.nodes[0].provider.id = 'other' }],
    ['review checkpoint', (document) => { document.nodes[0].autoContinue = false }],
    ['nodes', (document) => { document.nodes.pop() }],
    ['connections', (document) => { document.edges.pop() }],
    ['inputs', (document) => { document.inputs[0].required = false }],
    ['outputs', (document) => { document.outputs[0].source.nodeId = 'a' }],
    ['node layout', (document) => { document.presentation.positions.a = { x: 100, y: 200 } }],
  ]
  it.each(edits)('detects %s edits even after viewing the canvas', (_, edit) => {
    const document = graph(), saved = serializeWorkflowEdits(document)
    document.presentation.viewport = { x: 120, y: 90, zoom: 0.5 }
    edit(document)
    expect(serializeWorkflowEdits(document)).not.toBe(saved)
  })

  it('clears unsaved state when an edit is reverted after zooming', () => {
    const document = graph(), saved = serializeWorkflowEdits(document)
    document.title = 'Edited'
    document.presentation.viewport.zoom = 0.5
    expect(serializeWorkflowEdits(document)).not.toBe(saved)
    document.title = 'Test'
    expect(serializeWorkflowEdits(document)).toBe(saved)
  })
})
