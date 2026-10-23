import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { SubtitleWorkflow } from '../src/workflow.mjs';

const transcript = { detected_language: 'en', segments: [{ id: 's1', start_ms: 0, end_ms: 1000, text: 'Original words', words: null }] };
async function fixture(overrides = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'youdub-harness-test-'));
  let workflow;
  const runner = {
    recognize: async () => ({ transcript: structuredClone(transcript), mediaInfo: { duration_ms: 2000 } }),
    export: async task => writeFile(resolve(workflow.dir(task.id), 'subtitles.srt'), `1\n00:00:00,000 --> 00:00:01,000\n${task.transcript.segments[0].text}\n`),
    ...overrides,
  };
  workflow = new SubtitleWorkflow(root, runner); await workflow.init();
  const task = await workflow.importVideo('sample.mp4', new Blob(['video fixture']).stream());
  return { workflow, task, root, runner };
}
async function recognize(workflow, task) {
  await workflow.recognize(task.id, task.revision, 'en');
  const done = workflow.active.done;
  await done;
  return workflow.get(task.id);
}

test('review persists across host restart; corrected text requires confirmation and reaches export', async () => {
  const { workflow, task, root, runner } = await fixture();
  const reviewed = await recognize(workflow, task);
  assert.equal(reviewed.status, 'awaiting_review');
  assert.equal(workflow.active, null);
  await assert.rejects(workflow.export(task.id, reviewed.revision), { code: 'REVIEW_REQUIRED' });
  const edited = await workflow.edit(task.id, reviewed.revision, [{ id: 's1', text: 'Corrected words' }]);
  assert.equal(edited.status, 'awaiting_review');
  const restarted = new SubtitleWorkflow(root, runner); await restarted.init();
  assert.equal((await restarted.get(task.id)).transcript.segments[0].text, 'Corrected words');
  const confirmed = await restarted.confirm(task.id, edited.revision);
  assert.equal(confirmed.status, 'confirmed');
  const result = await restarted.export(task.id, confirmed.revision);
  assert.match(result.toString(), /Corrected words/);
  assert.equal((await restarted.get(task.id)).status, 'exported');
  assert.equal(JSON.parse(await readFile(resolve(workflow.dir(task.id), 'asr.original.json'))).segments[0].text, 'Original words');
  const exported = await restarted.get(task.id);
  const changed = await restarted.edit(task.id, exported.revision, [{ id: 's1', text: 'Second correction' }]);
  assert.equal(changed.confirmedRevision, null);
  await assert.rejects(restarted.export(task.id, changed.revision), { code: 'REVIEW_REQUIRED' });
});

test('stale saves and blank corrections are rejected without changing the checkpoint', async () => {
  const { workflow, task } = await fixture(); const reviewed = await recognize(workflow, task);
  await assert.rejects(workflow.edit(task.id, reviewed.revision - 1, [{ id: 's1', text: 'Changed' }]), { code: 'STALE_REVISION' });
  await assert.rejects(workflow.edit(task.id, reviewed.revision, [{ id: 's1', text: '  ' }]), { code: 'INVALID_TRANSCRIPT' });
  assert.deepEqual(await workflow.get(task.id), reviewed);
  const results = await Promise.allSettled([workflow.confirm(task.id, reviewed.revision), workflow.edit(task.id, reviewed.revision, [{ id: 's1', text: 'Conflicting save' }])]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('only one recognition runs; review releases the worker for another video', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { workflow, task } = await fixture({ recognize: async () => { await gate; return { transcript, mediaInfo: { duration_ms: 2000 } }; } });
  const next = await workflow.importVideo('second.mp4', new Blob(['second']).stream());
  await workflow.recognize(task.id, task.revision, 'auto');
  await assert.rejects(workflow.recognize(next.id, next.revision, 'en'), { code: 'WORKER_BUSY' });
  const done = workflow.active.done; release(); await done;
  assert.equal((await workflow.get(task.id)).status, 'awaiting_review');
  const second = await recognize(workflow, next);
  assert.equal(second.status, 'awaiting_review');
  assert.equal((await workflow.get(task.id)).status, 'awaiting_review');
});

test('worker failure preserves the cause and never reaches confirmation or export', async () => {
  const cause = Object.assign(new Error('FFmpeg: invalid media'), { code: 'INVALID_MEDIA' });
  const { workflow, task } = await fixture({ recognize: async () => { throw cause; } });
  const failed = await recognize(workflow, task);
  assert.equal(failed.status, 'failed'); assert.deepEqual(failed.error, { code: 'INVALID_MEDIA', message: cause.message });
  assert.equal(workflow.active, null);
  await assert.rejects(workflow.confirm(task.id, failed.revision));
});

test('restart marks interrupted work failed and leaves review checkpoints untouched', async () => {
  const { workflow, task, root, runner } = await fixture();
  task.status = 'recognizing'; await workflow.save(task);
  const restarted = new SubtitleWorkflow(root, runner); await restarted.init();
  assert.equal((await restarted.get(task.id)).error.code, 'HOST_INTERRUPTED');
});

test('export failure is visible and never reports a completed export', async () => {
  const { workflow, task } = await fixture({ export: async () => { throw new Error('writer unavailable'); } });
  const reviewed = await recognize(workflow, task); const confirmed = await workflow.confirm(task.id, reviewed.revision);
  await assert.rejects(workflow.export(task.id, confirmed.revision), /writer unavailable/);
  const failed = await workflow.get(task.id); assert.equal(failed.status, 'failed'); assert.equal(failed.error.message, 'writer unavailable');
});
