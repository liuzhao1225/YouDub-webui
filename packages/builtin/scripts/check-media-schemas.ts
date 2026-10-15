import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Ajv from 'ajv'
import { mediaSchemas, artifactRef } from '../src/media-schemas.js'
import { operations } from '../src/media-contracts.js'

const ajv = new Ajv({ allErrors: true, strict: true })
const audio = { id: 'sample-audio', schemaId: 'audio/wav/v1' }
const samples: Record<string, any> = {
  'transcript/v1': { detected_language: 'en', segments: [{ id: '1', start_ms: 0, end_ms: 1000, text: 'Hello.', speaker_id: null, words: [{ start_ms: 0, end_ms: 1000, text: 'Hello.' }] }] },
  'translation/v1': { source_language: 'en', target_language: 'zh', segments: [{ segment_id: '1', text: '你好。' }] },
  'media-info/v1': { duration_ms: 1000, width: 320, height: 180, frame_rate: 25, video_codec: 'h264', audio_codec: 'aac' },
  'voice-references/v1': [{ segmentId: '1', audio, transcript: 'Hello.' }],
  'speech-audio/v1': { segments: [{ id: '1', audio, sampleRate: 48000, channels: 1, sampleCount: 48000 }] },
  'dubbed-timeline/v1': { segments: [{ segment_id: '1', source_start_ms: 0, source_end_ms: 1000, dubbed_start_ms: 0, dubbed_end_ms: 1000 }] },
  'word-alignment/v1': [{ start_ms: 0, end_ms: 1000, text: '你好。' }],
  'diagnostic/json/v1': { provider_field: { arbitrary: [true, null, 'raw text'] } },
}
const malformed: Record<string, any> = {
  'transcript/v1': { detected_language: 'en', segments: [{ id: '1', start_ms: -1, end_ms: 1000, text: 'Hello.' }] },
  'translation/v1': { source_language: 'en', target_language: 'zh', segments: [{ segment_id: '1', text: ' ' }] },
  'media-info/v1': { ...samples['media-info/v1'], duration_ms: 1.5 },
  'voice-references/v1': [{ segmentId: '1', audio: { path: '/provider/local.wav' }, transcript: 'Hello.' }],
  'speech-audio/v1': { segments: [{ ...samples['speech-audio/v1'].segments[0], sampleCount: 0 }] },
  'dubbed-timeline/v1': { segments: [{ ...samples['dubbed-timeline/v1'].segments[0], dubbed_end_ms: 0 }] },
  'word-alignment/v1': [{ start_ms: 0, end_ms: 1000, text: 'Hello.', extra: true }],
  'diagnostic/json/v1': 'invalid top-level diagnostic',
}
for (const [id, schema] of Object.entries(mediaSchemas)) {
  const validate = ajv.compile(schema)
  assert(validate(samples[id]), `${id}: ${ajv.errorsText(validate.errors)}`)
  assert(!validate(malformed[id]), `${id} accepted malformed output`)
}
const validateReference = ajv.compile(artifactRef('audio/wav/v1'))
assert(!validateReference({ ...audio, path: '/local.wav' }))
assert(!validateReference({ ...audio, schemaId: 'transcript/v1' }))
const names: Record<string, any> = {
  video: { id: 'input', schemaId: 'file/v1' }, audio, sourceAudio: audio, background: audio, finalAudio: audio,
  mediaInfo: samples['media-info/v1'], transcript: samples['transcript/v1'], translation: samples['translation/v1'],
  references: samples['voice-references/v1'], speechAudio: samples['speech-audio/v1'], adjustedSpeech: samples['speech-audio/v1'],
  dubbedTimeline: samples['dubbed-timeline/v1'], wordAlignment: samples['word-alignment/v1'],
  sourceSubtitles: { id: 'source', schemaId: 'file/v1' }, translatedSubtitles: { id: 'translated', schemaId: 'application/x-subrip/v1' },
}
for (const operation of Object.values(operations)) {
  const validate = ajv.compile(operation.inputSchema)
  const values = Object.fromEntries(Object.keys(operation.inputSchema.properties).map(name => [name, names[name]]))
  assert(validate(values), `${operation.id}: ${ajv.errorsText(validate.errors)}`)
  const requiredOnly = Object.fromEntries(operation.inputSchema.required.map((name: string) => [name, names[name]]))
  assert(validate(requiredOnly), `${operation.id} rejects omitted optional inputs`)
  const missing = { ...requiredOnly }; delete missing[operation.inputSchema.required[0]]
  assert(!validate(missing), `${operation.id} accepts a missing required input`)
  for (const output of operation.outputs.filter(port => port.kind === 'json')) {
    assert(output.schema, `${operation.id}/${output.name} has no output schema`)
    assert(ajv.compile(output.schema)(samples[output.schemaId]), `${operation.id}/${output.name} rejects its standard shape`)
  }
}
// Optional immutable worker result files provide integration evidence from real
// model runs. Resolve invocation-local markers exactly as the host does first.
for (const path of process.argv.slice(2)) {
  const result = JSON.parse(await readFile(path, 'utf8'))
  const resolve = (value: any): any => {
    if (Array.isArray(value)) return value.map(resolve)
    if (value && typeof value === 'object') {
      if (Object.hasOwn(value, '$artifact')) return { id: value.$artifact, schemaId: result.artifacts[value.$artifact].schemaId }
      return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, resolve(item)]))
    }
    return value
  }
  const outputs = resolve(result.outputs)
  for (const [name, value] of Object.entries(outputs)) {
    const port = Object.values(operations).flatMap(operation => operation.outputs).find(port => port.name === name && port.kind === 'json')
    if (!port) continue
    const validate = ajv.compile(port.schema!)
    assert(validate(value), `${path}/${name}: ${ajv.errorsText(validate.errors)}`)
  }
}
console.log(`Validated ${Object.keys(mediaSchemas).length} schemas and ${Object.keys(operations).length} operation contracts.`)
