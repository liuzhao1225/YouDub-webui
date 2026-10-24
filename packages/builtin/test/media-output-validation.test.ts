import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import { Context } from 'cordis'
import Catalog from '../src/catalog.js'
import * as MediaValidation from '../src/media-output-validation.js'
import { mediaSchemas } from '../src/media-schemas.js'

const transcript = { detected_language: 'en', segments: [{ id: 'one', start_ms: 10, end_ms: 100, text: 'one', words: [{ text: 'one', start_ms: 10, end_ms: 100 }] }] }
const translation = { source_language: 'en', target_language: 'zh', segments: [{ segment_id: 'one', text: '一' }] }
const timeline = { segments: [{ segment_id: 'one', source_start_ms: 10, source_end_ms: 100, dubbed_start_ms: 0, dubbed_end_ms: 80 }] }
const context = { inputs: { transcript, translation, mediaInfo: { duration_ms: 100 } }, outputs: {} }
const cases = [
  { schema: 'transcript/v1', value: transcript, valid: true },
  { schema: 'transcript/v1', value: { ...transcript, segments: [{ ...transcript.segments[0], start_ms: 100, end_ms: 50, words: null }] }, valid: false },
  { schema: 'transcript/v1', value: { ...transcript, segments: [transcript.segments[0], transcript.segments[0]] }, valid: false },
  { schema: 'transcript/v1', value: { ...transcript, segments: [{ ...transcript.segments[0], text: 'different' }] }, valid: false },
  { schema: 'transcript/v1', value: { ...transcript, segments: [{ ...transcript.segments[0], words: [{ text: 'one', start_ms: 50, end_ms: 101 }] }] }, valid: false },
  { schema: 'translation/v1', value: translation, valid: true },
  { schema: 'translation/v1', value: { ...translation, source_language: 'ja' }, valid: false },
  { schema: 'translation/v1', value: { ...translation, segments: [{ segment_id: 'other', text: '一' }] }, valid: false },
  { schema: 'translation/v1', value: { ...translation, segments: [translation.segments[0], translation.segments[0]] }, valid: false },
  { schema: 'word-alignment/v1', value: [{ start_ms: 0, end_ms: 90, text: '一' }], valid: true },
  { schema: 'word-alignment/v1', value: [{ start_ms: 0, end_ms: 90, text: '二' }], valid: false },
  { schema: 'word-alignment/v1', value: [{ start_ms: 0, end_ms: 101, text: '一' }], valid: false },
  { schema: 'dubbed-timeline/v1', value: timeline, valid: true },
  { schema: 'dubbed-timeline/v1', value: { segments: [{ ...timeline.segments[0], source_start_ms: 9 }] }, valid: false },
  { schema: 'dubbed-timeline/v1', value: { segments: [{ ...timeline.segments[0], dubbed_end_ms: 101 }] }, valid: false },
  { schema: 'dubbed-timeline/v1', value: { segments: [{ ...timeline.segments[0], dubbed_end_ms: 0 }] }, valid: false },
]

test('the producer boundary and Python consumers agree on media semantic cases', () => {
  const ajv = new Ajv({ strict: false })
  const actual = cases.map(item => {
    if (!ajv.validate(mediaSchemas[item.schema], item.value)) return false
    try { MediaValidation.mediaOutputValidators[item.schema](item.value, context); return true } catch { return false }
  })
  assert.deepEqual(actual, cases.map(item => item.valid))
  const python = process.env.YOUDUB_TEST_PYTHON || resolve('.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const result = spawnSync(python, ['-B', '-c', `import json,sys
from backend.app.v1.segments import Transcript, Translation
from backend.app.v1.audio_segments import Alignment
from backend.app.v1.export import _validate_prepared_cues
from backend.app.v1.errors import ApiError
request=json.load(sys.stdin)
transcript=Transcript.model_validate(request['transcript'])
results=[]
for case in request['cases']:
    try:
        if case['schema']=='transcript/v1': Transcript.model_validate(case['value'])
        elif case['schema']=='translation/v1': Translation.model_validate(case['value']).match(transcript)
        elif case['schema']=='word-alignment/v1': _validate_prepared_cues([(item['start_ms'],item['end_ms'],item['text']) for item in case['value']],[(transcript.segments[0],'一')],100)
        else: Alignment.model_validate(case['value']).match(transcript,100)
        results.append(True)
    except (ValueError,ApiError): results.append(False)
print(json.dumps(results))
`], { cwd: process.cwd(), input: JSON.stringify({ transcript, cases }), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), actual)
})

test('media validator registration follows plugin lifecycle', async () => {
  const ctx = new Context(), catalog = await ctx.plugin(Catalog), media = await ctx.plugin(MediaValidation)
  try {
    assert.throws(() => ctx.catalog.validateOutput('translation/v1', cases[6].value, context), /original segments/)
    await media.dispose()
    assert.doesNotThrow(() => ctx.catalog.validateOutput('translation/v1', cases[6].value, context))
  } finally { await catalog.dispose() }
})

test('source audio timestamps may extend beyond video while dubbed audio remains inside it', () => {
  const source = { detected_language: 'en', segments: [{ id: 'tail', start_ms: 2443000, end_ms: 2443560, text: 'Last word.' }] }
  const tail = { segments: [{ segment_id: 'tail', source_start_ms: 2443000, source_end_ms: 2443560, dubbed_start_ms: 2443000, dubbed_end_ms: 2443542 }] }
  const tailContext = { inputs: { transcript: source, mediaInfo: { duration_ms: 2443542 } }, outputs: {} }
  assert.doesNotThrow(() => MediaValidation.mediaOutputValidators['dubbed-timeline/v1'](tail, tailContext))
  tail.segments[0].dubbed_end_ms++
  assert.throws(() => MediaValidation.mediaOutputValidators['dubbed-timeline/v1'](tail, tailContext), /fit the video/)
})
