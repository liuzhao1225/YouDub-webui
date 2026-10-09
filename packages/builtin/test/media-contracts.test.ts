import { test } from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv/dist/2020.js'
import { operations } from '../src/media-contracts.js'
import { referencesSchema } from '../src/media-schemas.js'

test('voice reference output and TTS input require the matching utterance ID', () => {
  const validator = new Ajv({ strict: false })
  const validate = validator.compile(referencesSchema)
  const reference = { segmentId: 'utterance-1', audio: { id: 'reference-1', schemaId: 'audio/wav/v1' }, transcript: 'Original sentence.' }
  assert.equal(validate([reference]), true)
  for (const segmentId of [null, '', '  ', 42]) {
    assert.equal(validate([{ ...reference, segmentId }]), false)
  }
  const { segmentId: _, ...withoutId } = reference
  assert.equal(validate([withoutId]), false)
  assert.equal(validate([{ ...withoutId, speakerId: 'speaker-1' }]), false)
  assert.equal(validate([{ ...reference, speakerId: 'speaker-1' }]), false)
  assert.deepEqual(operations.reference.outputs[0].schema, referencesSchema)
  const synthesize = validator.compile(operations.synthesize.inputSchema)
  const inputs = {
    transcript: { detected_language: 'en', segments: [{ id: 'utterance-1', start_ms: 0, end_ms: 1000, text: 'Original sentence.' }] },
    translation: { source_language: 'en', target_language: 'zh', segments: [{ segment_id: 'utterance-1', text: '原文句子。' }] },
    references: [reference],
  }
  assert.equal(synthesize(inputs), true)
  assert.equal(synthesize({ ...inputs, references: [{ ...withoutId, speakerId: null }] }), false)
})
