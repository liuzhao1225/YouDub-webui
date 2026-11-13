import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { register } from 'tsx/esm/api';

const source = register({ namespace: 'whisper-postprocess' });
const { postprocessWhisper } = await source.import('../src/backend/whisper-postprocess.mjs', import.meta.url);
source.unregister();

test('Whisper postprocessing splits and joins original fragments while rebuilding the sentence timeline', async t => {
  const workDir = await mkdtemp(join(tmpdir(), 'youdub-whisper-sentences-'));
  t.after(() => rm(workDir, { recursive: true, force: true }));
  const words = [
    ['Dr.', 100, 200], [' Smith', 200, 300], [' arrived.', 400, 550],
    [' Yeah.', 570, 570], [' Right.', 1100, 1100], [' Next', 1200, 1300], [' came', 1300, 1400],
    [' 3.14.', 1400, 1500], [' Go', 1800, 1900], [' now.', 1900, 2000],
    [' Go', 2200, 2300], [' now.', 2300, 2400],
  ].map(([text, start_ms, end_ms]) => ({ text, start_ms, end_ms }));
  const original = {
    detected_language: 'en',
    segments: [words.slice(0, 2), words.slice(2, 10), words.slice(10)].map((words, index) => ({
      id: 'whisper-' + index, text: words.map(word => word.text).join(''),
      start_ms: words[0].start_ms, end_ms: words.at(-1).end_ms, words,
    })),
  };
  const rawPath = join(workDir, 'asr_raw.json');
  const raw = JSON.stringify({ text: words.map(word => word.text).join(''), language: 'en' });
  await writeFile(rawPath, raw);
  const rawRef = { id: 'raw', schemaId: 'diagnostic/json/v1' };
  const context = { signal: new AbortController().signal, resolve: async ref => {
    assert.deepEqual(ref, rawRef);
    return rawPath;
  } };
  const result = await postprocessWhisper({ state: 'completed', outputs: { transcript: original, raw: rawRef } }, { workDir }, context);
  assert.deepEqual(result.outputs.raw, rawRef);
  assert.equal(await readFile(rawPath, 'utf8'), raw);
  const { transcript } = result.outputs;
  assert.deepEqual(JSON.parse(await readFile(join(workDir, 'transcript.json'), 'utf8')), transcript);
  assert.deepEqual(transcript.segments.map(({ words, ...segment }) => segment), [
    { id: 'segment-000001', text: 'Dr. Smith arrived. Yeah.', start_ms: 100, end_ms: 570 },
    { id: 'segment-000002', text: ' Right. Next came 3.14.', start_ms: 1100, end_ms: 1500 },
    { id: 'segment-000003', text: ' Go now.', start_ms: 1800, end_ms: 2000 },
    { id: 'segment-000004', text: ' Go now.', start_ms: 2200, end_ms: 2400 },
  ]);
  assert.deepEqual(transcript.segments.flatMap(segment => segment.words), words);
});

test('Whisper postprocessing reports a divergent word sequence without writing a transcript', async t => {
  const workDir = await mkdtemp(join(tmpdir(), 'youdub-whisper-sentences-'));
  t.after(() => rm(workDir, { recursive: true, force: true }));
  const rawPath = join(workDir, 'asr_raw.json');
  await writeFile(rawPath, JSON.stringify({ text: 'The race starts.' }));
  const transcript = { detected_language: 'en', segments: [{ id: 's1', words: [
    { text: 'The race stops.', start_ms: 0, end_ms: 1000 },
  ] }] };
  await assert.rejects(
    postprocessWhisper({ state: 'completed', outputs: { transcript } }, { workDir }, {
      signal: new AbortController().signal, resolve: async () => rawPath,
    }),
    { code: 'INVALID_PROVIDER_RESULT', message: 'Whisper sentence 1 does not match timed word 1.' },
  );
  await assert.rejects(readFile(join(workDir, 'transcript.json')), { code: 'ENOENT' });
});
