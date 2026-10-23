import { videoSource } from '@youdub/sdk/video-source'
import type { Diagnostic, GraphNode, JsonObject, NodeTypeDefinition, WorkflowDocument } from '@youdub/sdk'
import { nodeDescriptors } from './node-contracts.js'

type Fail = (message: string, location?: Partial<Diagnostic>, code?: string) => void
const mediaTypes = new Set(Object.values(nodeDescriptors).map(node => node.type))

/** Built-in media rules stay separate from port, topology and plugin schema checks. */
export function normalizeMediaRuntime(node: GraphNode, type: NodeTypeDefinition, runtime: Record<string, JsonObject>, fail: Fail) {
  if (type.type === 'youdub.download') {
    try { return { ...runtime, [node.id]: { ...runtime[node.id], url: videoSource(runtime[node.id].url).url } } }
    catch (error) { fail((error as Error).message, { nodeId: node.id, field: 'url' }) }
  }
  return runtime
}
export function validateMediaNodeConfig(node: GraphNode, type: NodeTypeDefinition, config: JsonObject, model: JsonObject | undefined, fail: Fail) {
  if (!mediaTypes.has(type.type)) return
  if (model) {
    if (config.sourceLanguage && config.sourceLanguage !== 'auto' && model.source_languages && !model.source_languages.includes(config.sourceLanguage)) fail('Source language is unsupported.', { nodeId: node.id, field: 'sourceLanguage' })
    if (config.targetLanguage && model.target_languages && !model.target_languages.includes(config.targetLanguage)) fail('Target language is unsupported.', { nodeId: node.id, field: 'targetLanguage' })
    if (config.voice && model.voice_modes && !model.voice_modes.includes(config.voice.mode)) fail('Voice mode is unsupported.', { nodeId: node.id, field: 'voice' })
    if (config.voice?.mode === 'preset' && !model.voices?.some((voice: any) => voice.id === config.voice.id && voice.languages.includes(config.targetLanguage))) fail('Selected voice is unavailable.', { nodeId: node.id, field: 'voice' })
  }
  if (config.targetLanguage === 'auto' || (config.sourceLanguage && config.sourceLanguage === config.targetLanguage)) fail('Select different source and target languages.', { nodeId: node.id, field: 'targetLanguage' })
}
export function validateMediaGraph(document: WorkflowDocument, types: Map<string, NodeTypeDefinition>, options: Map<string, JsonObject>, connected: (id: string, port: string) => boolean, fail: Fail) {
  const upstreamConfig = (nodeId: string, portId: string) => options.get(document.edges.find(edge => edge.target.nodeId === nodeId && edge.target.portId === portId)?.source.nodeId ?? '')
  for (const node of document.nodes) {
    const type = types.get(node.id), config = options.get(node.id)
    if (!type || !config || !mediaTypes.has(type.type)) continue
    if (type.type === 'youdub.synthesize' && config.voice?.mode === 'source_clone' && !connected(node.id, 'references')) fail('Source cloning requires voice references.', { nodeId: node.id, portId: 'references' })
    if (type.type === 'youdub.mix' && config.keepBackground && !connected(node.id, 'background')) fail('Background mixing requires a background input.', { nodeId: node.id, portId: 'background' })
    const translated = upstreamConfig(node.id, 'translation')
    if (translated?.targetLanguage && config.targetLanguage && translated.targetLanguage !== config.targetLanguage) fail('Target language must match the connected translation.', { nodeId: node.id, field: 'targetLanguage' })
    if (type.type === 'youdub.export') {
      const audio = connected(node.id, 'finalAudio'), timeline = connected(node.id, 'dubbedTimeline')
      if (audio !== timeline) fail('Connect final audio and its timeline together.', { nodeId: node.id, portId: 'dubbedTimeline' })
      if (!audio && !config.renderSubtitles) fail('Export requires subtitles or final audio.', { nodeId: node.id, field: 'renderSubtitles' })
      config.outputMode = audio ? config.renderSubtitles ? 'both' : 'dubbing' : 'subtitles'
    }
  }
  const inputSource = (id: string, port: string) => document.edges.find(edge => edge.target.nodeId === id && edge.target.portId === port)?.source
  const sameSource = (actual: ReturnType<typeof inputSource>, expected: ReturnType<typeof inputSource>) => actual && expected && actual.nodeId === expected.nodeId && actual.portId === expected.portId
  const expectSource = (nodeId: string, portId: string, expected: ReturnType<typeof inputSource>) => {
    if (expected && !sameSource(inputSource(nodeId, portId), expected)) fail('Connect data from the same upstream result.', { nodeId, portId })
  }
  const translatedTranscript = (id: string) => {
    const input = inputSource(id, 'translation'), type = input && types.get(input.nodeId)?.type
    return type === 'youdub.translate' ? inputSource(input!.nodeId, 'transcript') : type === 'youdub.importSubtitles' ? { nodeId: input!.nodeId, portId: 'transcript' } : undefined
  }
  for (const node of document.nodes) {
    const type = types.get(node.id)?.type
    if (['youdub.synthesize', 'youdub.align', 'youdub.export'].includes(type ?? '')) expectSource(node.id, 'transcript', translatedTranscript(node.id))
    if (type === 'youdub.synthesize') {
      const input = inputSource(node.id, 'references')
      if (input && types.get(input.nodeId)?.type === 'youdub.reference') expectSource(node.id, 'transcript', inputSource(input.nodeId, 'transcript'))
    }
    if (type === 'youdub.mix') {
      const input = inputSource(node.id, 'speechAudio')
      if (input && types.get(input.nodeId)?.type === 'youdub.synthesize') expectSource(node.id, 'transcript', inputSource(input.nodeId, 'transcript'))
    }
    if (type === 'youdub.export' || type === 'youdub.align') {
      const input = inputSource(node.id, type === 'youdub.export' ? 'finalAudio' : 'dubbedTimeline')
      if (input && types.get(input.nodeId)?.type === 'youdub.mix') {
        expectSource(node.id, type === 'youdub.export' ? 'dubbedTimeline' : 'adjustedSpeech', { nodeId: input.nodeId, portId: type === 'youdub.export' ? 'dubbedTimeline' : 'adjustedSpeech' })
        expectSource(node.id, 'transcript', inputSource(input.nodeId, 'transcript'))
        if (type === 'youdub.export') expectSource(node.id, 'mediaInfo', inputSource(input.nodeId, 'mediaInfo'))
      }
      if (type === 'youdub.export') {
        const media = inputSource(node.id, 'mediaInfo')
        if (media && types.get(media.nodeId)?.type === 'youdub.prepare') expectSource(node.id, 'video', inputSource(media.nodeId, 'video'))
      }
    }
  }
  for (const output of document.outputs) {
    const type = types.get(output.source.nodeId), config = options.get(output.source.nodeId)
    if (type?.type === 'youdub.export' && ((['sourceSubtitles', 'translatedSubtitles'].includes(output.source.portId) && !config?.renderSubtitles) || (output.source.portId === 'audio' && !connected(output.source.nodeId, 'finalAudio')))) fail('The selected export output is not produced by this node configuration.', { nodeId: output.source.nodeId, portId: output.source.portId })
  }
}
