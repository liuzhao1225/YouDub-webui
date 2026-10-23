import { expect, it } from 'vitest'
import reviewedSubtitles from '../../../../packages/builtin/src/workflow-templates/reviewed-subtitles.json'
import { nodeDescriptors } from '../../../../packages/builtin/src/node-contracts'
import type { NodeTypeDefinition, WorkflowDocument } from './contracts'
import { compatibleInputFiles, videoLinkInput, withVideoLink } from './builtin/workflow-launch'
import { canConnect } from './builtin/workflow-utils'

const document = reviewedSubtitles as WorkflowDocument
const types = Object.values(nodeDescriptors).map((descriptor) => ({ ...descriptor, providerId: 'youdub.media', provider: { id: 'youdub.media', operations: [] }, operation: descriptor.type.split('.')[1], outputs: descriptor.type === 'youdub.download' ? [{ name: 'video', kind: 'artifact', schemaId: 'video/mp4/v1', required: true }] : [] })) as NodeTypeDefinition[]

it('imports links into the real reviewed-subtitles template without changing the template or its review gates', () => {
  const original = structuredClone(document)
  expect(document.inputs[0].schemaId).toBe('file/v1')
  expect(videoLinkInput(document, types)?.id).toBe('video')
  const result = withVideoLink(document, types, 'video', 'https://www.youtube.com/watch?v=12345678901')
  expect(document).toEqual(original)
  expect(result.document.inputs).toEqual([])
  const added = result.document.nodes.find((node) => node.type === 'youdub.download')!
  expect(added.config.proxyPort).toBe(0)
  expect(result.runtime[added.id]).toEqual({ url: 'https://www.youtube.com/watch?v=12345678901' })
  expect(JSON.stringify(result.document)).not.toContain('youtube.com')
  expect(result.document.nodes.slice(1)).toEqual(document.nodes)
  expect(result.document.nodes.filter((node) => !node.autoContinue).map((node) => node.id)).toEqual(['recognize', 'translate'])
  const edges = result.document.edges.filter((edge) => edge.source.nodeId === added.id)
  expect(edges).toHaveLength(document.edges.filter((edge) => edge.source.nodeId === '$inputs').length)
  for (const edge of edges) expect(canConnect(result.document, types, edge.source, edge.target)).toBe(true)
})

it('keeps the selected proxy port on the download node and keeps the URL in per-run inputs', () => {
  const result = withVideoLink(document, types, 'video', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', 7897)
  const added = result.document.nodes[0]
  expect(added.config.proxyPort).toBe(7897)
  expect(result.runtime[added.id]).toEqual({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' })
  const prepare = result.document.edges.find((edge) => edge.target.nodeId === 'prepare')!
  expect(prepare.source).toEqual({ nodeId: added.id, portId: 'video' })
  expect(canConnect(result.document, types, prepare.source, prepare.target)).toBe(true)
})

it('does not offer links when a consumer cannot accept downloaded video', () => {
  const incompatible = types.map((type) => type.type === 'youdub.prepare' ? { ...type, inputs: type.inputs.map((input) => ({ ...input, acceptedSchemaIds: ['file/v1'] })) } : type)
  expect(videoLinkInput(document, incompatible)).toBeUndefined()
  expect(() => withVideoLink(document, incompatible, 'video', 'https://youtu.be/12345678901')).toThrow()
})

it('preserves each compatible file once and reserves exact input matches before renamed ones', () => {
  const first = document.inputs[0], second = { ...first, id: 'second' }
  const a = new File(['a'], 'a.mp4', { type: 'video/mp4' }), b = new File(['b'], 'b.mp4', { type: 'video/mp4' })
  expect(compatibleInputFiles([{ input: first, file: a }, { input: second, file: b }], [{ ...first, id: 'renamed' }, first])).toEqual({ video: a, renamed: b })
  expect(compatibleInputFiles([{ input: first, file: a }], [{ ...first, schemaId: 'text/v1' }])).toEqual({})
  expect(compatibleInputFiles([{ input: first, file: a }], [{ ...first, maxBytes: 0 }])).toEqual({})
})
