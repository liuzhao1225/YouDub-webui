import type { OutputPort, JsonObject, ProviderDescription } from '@youdub/sdk'
import { artifactRef, mediaSchemas } from './media-schemas.js'

const artifact = (name: string, schemaId: string, required = true): OutputPort => ({ name, schemaId, kind: 'artifact', required })
const json = (name: string, schemaId: string): OutputPort => ({ name, schemaId, kind: 'json', required: true, schema: mediaSchemas[schemaId] })
const input = (properties: Record<string, JsonObject>, required = Object.keys(properties)): JsonObject => ({
  type: 'object', additionalProperties: false, required, properties,
})
const audio = artifactRef('audio/wav/v1')
const video = artifactRef('file/v1', 'video/mp4/v1')
const subtitles = artifactRef('file/v1', 'application/x-subrip/v1')
const transcript = mediaSchemas['transcript/v1']
const translation = mediaSchemas['translation/v1']
const mediaInfo = mediaSchemas['media-info/v1']
const speechAudio = mediaSchemas['speech-audio/v1']
const dubbedTimeline = mediaSchemas['dubbed-timeline/v1']

export const operations: Record<string, ProviderDescription['operations'][number]> = {
  prepare: { id: 'media.prepare/v1', inputSchema: input({ video }), outputs: [artifact('sourceAudio', 'audio/wav/v1'), json('mediaInfo', 'media-info/v1')] },
  separate: { id: 'audio.separate/v1', inputSchema: input({ sourceAudio: audio }), outputs: [artifact('vocals', 'audio/wav/v1'), artifact('background', 'audio/wav/v1')] },
  recognize: { id: 'speech.transcribe/v1', inputSchema: input({ audio, mediaInfo }), outputs: [json('transcript', 'transcript/v1'), artifact('raw', 'diagnostic/json/v1', false)] },
  translate: { id: 'text.translate/v1', inputSchema: input({ transcript }), outputs: [json('translation', 'translation/v1')] },
  reference: { id: 'voice.reference/v1', inputSchema: input({ transcript, audio }), outputs: [json('references', 'voice-references/v1')] },
  synthesize: { id: 'speech.synthesize/v1', inputSchema: input({ transcript, translation, references: mediaSchemas['voice-references/v1'] }, ['transcript', 'translation']), outputs: [json('speechAudio', 'speech-audio/v1')] },
  mix: { id: 'audio.mix/v1', inputSchema: input({ transcript, speechAudio, mediaInfo, background: audio }, ['transcript', 'speechAudio', 'mediaInfo']), outputs: [artifact('finalAudio', 'audio/wav/v1'), json('dubbedTimeline', 'dubbed-timeline/v1'), json('adjustedSpeech', 'speech-audio/v1')] },
  align: { id: 'text.align/v1', inputSchema: input({ transcript, translation, dubbedTimeline, adjustedSpeech: speechAudio }), outputs: [json('wordAlignment', 'word-alignment/v1')] },
  export: { id: 'media.export/v1', inputSchema: input({ video, mediaInfo, transcript, translation, finalAudio: audio, dubbedTimeline, wordAlignment: mediaSchemas['word-alignment/v1'] }, ['video', 'mediaInfo', 'transcript', 'translation']), outputs: [artifact('video', 'video/mp4/v1'), artifact('audio', 'audio/wav/v1', false), artifact('sourceSubtitles', 'application/x-subrip/v1', false), artifact('translatedSubtitles', 'application/x-subrip/v1', false)] },
  importSubtitles: { id: 'subtitles.import/v1', inputSchema: input({ sourceSubtitles: subtitles, translatedSubtitles: subtitles }), outputs: [json('transcript', 'transcript/v1'), json('translation', 'translation/v1')] },
}
