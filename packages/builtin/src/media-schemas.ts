import type { JsonObject } from '@youdub/sdk'

const text: JsonObject = { type: 'string', minLength: 1, pattern: '\\S' }
const milliseconds: JsonObject = { type: 'integer', minimum: 0 }
const positiveInteger: JsonObject = { type: 'integer', minimum: 1 }
const nullable = (schema: JsonObject): JsonObject => ({ anyOf: [schema, { type: 'null' }] })
const array = (items: JsonObject): JsonObject => ({ type: 'array', minItems: 1, items })
const object = (properties: Record<string, JsonObject>, required = Object.keys(properties)): JsonObject => ({
  type: 'object', additionalProperties: false, properties, required,
})

/** Public references never carry provider-local paths or worker $artifact markers. */
export const artifactRef = (...schemaIds: string[]): JsonObject => object({
  id: text,
  schemaId: schemaIds.length ? { type: 'string', enum: schemaIds } : text,
})

const timedWord = object({ text, start_ms: milliseconds, end_ms: milliseconds })
const segment = object({
  id: text, start_ms: milliseconds, end_ms: positiveInteger, text,
  speaker_id: nullable(text), words: nullable(array(timedWord)),
}, ['id', 'start_ms', 'end_ms', 'text'])

export const transcriptSchema = object({ detected_language: text, segments: array(segment) })
export const translationSchema = object({
  source_language: text, target_language: text,
  segments: array(object({ segment_id: text, text })),
})
export const mediaInfoSchema = object({
  duration_ms: positiveInteger, width: positiveInteger, height: positiveInteger,
  frame_rate: { type: 'number', exclusiveMinimum: 0 }, video_codec: text, audio_codec: text,
})
export const referencesSchema = array(object({
  speakerId: nullable(text), audio: artifactRef('audio/wav/v1'), transcript: text,
}))
export const speechAudioSchema = object({
  segments: array(object({
    id: text, audio: artifactRef('audio/wav/v1'), sampleRate: positiveInteger,
    channels: { type: 'integer', enum: [1, 2] }, sampleCount: positiveInteger,
  })),
})
export const dubbedTimelineSchema = object({
  segments: array(object({
    segment_id: text, source_start_ms: milliseconds, source_end_ms: positiveInteger,
    dubbed_start_ms: milliseconds, dubbed_end_ms: positiveInteger,
  })),
})
export const wordAlignmentSchema = array(object({ start_ms: milliseconds, end_ms: positiveInteger, text }))

// Raw diagnostic objects retain supplier-specific fields unchanged. This is
// intentionally separate from the normalized transcript contract.
export const rawDiagnosticSchema: JsonObject = { type: 'object', additionalProperties: true }

/** Inline schemas remain usable when copied into immutable task plans. */
export const mediaSchemas: Record<string, JsonObject> = {
  'transcript/v1': transcriptSchema,
  'translation/v1': translationSchema,
  'media-info/v1': mediaInfoSchema,
  'voice-references/v1': referencesSchema,
  'speech-audio/v1': speechAudioSchema,
  'dubbed-timeline/v1': dubbedTimelineSchema,
  'word-alignment/v1': wordAlignmentSchema,
  'diagnostic/json/v1': rawDiagnosticSchema,
}
