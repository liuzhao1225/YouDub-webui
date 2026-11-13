import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import init, { segment } from 'sentencex-wasm';
import { AppError } from '../../../../packages/sdk/src/index.ts';

const invalid = message => new AppError('INVALID_PROVIDER_RESULT', message, 422);
let sentencex;

export async function resegmentWhisper(text, transcript) {
  if (typeof text !== 'string' || !text.trim()) throw invalid('Whisper did not return the full transcript text.');
  const words = transcript.segments.flatMap(source => {
    if (!source.words?.length) throw invalid(`Whisper segment ${source.id} has no word timestamps.`);
    return source.words.map(word => ({ word, speaker: source.speaker_id }));
  });

  sentencex ??= readFile(new URL('./sentencex_wasm_bg.wasm', import.meta.resolve('sentencex-wasm')))
    .then(module_or_path => init({ module_or_path }));
  await sentencex;
  const slices = segment(transcript.detected_language, text);
  if (slices.join('') !== text) throw invalid('SentenceX did not preserve the full Whisper text.');

  // Boundary whitespace can differ between the full transcript and timed words.
  // Compare content in order, including punctuation, without changing the words.
  const withoutWhitespace = value => value.replace(/\s/gu, '');
  const sentences = [];
  let cursor = 0;
  for (const slice of slices) {
    const sentence = withoutWhitespace(slice);
    if (!sentence) continue;
    const first = cursor;
    let offset = 0;
    while (offset < sentence.length && cursor < words.length) {
      const { word } = words[cursor];
      const value = withoutWhitespace(word.text);
      if (!value || !sentence.startsWith(value, offset) || word.end_ms < word.start_ms) {
        throw invalid(`Whisper sentence ${sentences.length + 1} does not match timed word ${cursor + 1}.`);
      }
      cursor++;
      offset += value.length;
    }
    if (offset !== sentence.length) {
      throw invalid(`Whisper sentence ${sentences.length + 1} does not match its word sequence.`);
    }
    const start_ms = words[first].word.start_ms;
    const end_ms = words[cursor - 1].word.end_ms;
    if (end_ms < start_ms || (sentences.at(-1)?.end_ms ?? 0) > start_ms) {
      throw invalid(`Whisper sentence ${sentences.length + 1} has reversed or overlapping timestamps.`);
    }
    sentences.push({ first, end: cursor, start_ms, end_ms });
  }
  if (cursor !== words.length) throw invalid('Whisper word timestamps do not cover the full transcript.');

  const groups = [];
  let previous = -1, next = 0;
  for (const [index, sentence] of sentences.entries()) {
    let target = index;
    if (sentence.end_ms > sentence.start_ms) previous = index;
    else {
      if (next <= index) {
        next = index + 1;
        while (next < sentences.length && sentences[next].start_ms === sentences[next].end_ms) next++;
      }
      const before = previous < 0 ? Infinity : sentence.start_ms - sentences[previous].end_ms;
      const after = next === sentences.length ? Infinity : sentences[next].start_ms - sentence.end_ms;
      if (!Number.isFinite(Math.min(before, after))) throw invalid('Whisper returned no sentence with positive duration.');
      target = before <= after ? previous : next;
    }
    const group = groups.at(-1);
    if (group?.target === target) {
      group.end = sentence.end;
      group.end_ms = sentence.end_ms;
    } else groups.push({ ...sentence, target });
  }

  return {
    ...transcript,
    segments: groups.map(({ first, end, start_ms, end_ms }, index) => {
      const matched = words.slice(first, end);
      const speaker = matched[0].speaker;
      return {
        id: `segment-${String(index + 1).padStart(6, '0')}`,
        start_ms,
        end_ms,
        text: matched.map(({ word }) => word.text).join(''),
        words: matched.map(({ word }) => word),
        ...(speaker != null && matched.every(item => item.speaker === speaker) ? { speaker_id: speaker } : {}),
      };
    }),
  };
}

export async function postprocessWhisper(result, request, context) {
  context.signal.throwIfAborted();
  const raw = JSON.parse(await readFile(await context.resolve(result.outputs.raw), 'utf8'));
  const transcript = await resegmentWhisper(raw.text, result.outputs.transcript);
  context.signal.throwIfAborted();
  await writeFile(join(request.workDir, 'transcript.json'), JSON.stringify(transcript, null, 2));
  return { ...result, outputs: { ...result.outputs, transcript } };
}
