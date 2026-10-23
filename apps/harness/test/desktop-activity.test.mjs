import test from 'node:test';
import assert from 'node:assert/strict';
import { hasInterruptibleTasks } from '../src/backend/activity.mjs';

test('exit inspection distinguishes durable review from queued, running and remote work', async () => {
  const inspect = task => hasInterruptibleTasks({ call: async () => ({ items: [task], hasMore: false }) });
  for (const status of ['queued', 'running', 'waiting', 'cancelling']) assert.equal(await inspect({ status }), true, status);
  for (const status of ['paused', 'succeeded', 'failed', 'cancelled']) assert.equal(await inspect({ status }), false, status);
  for (const status of ['paused', 'failed', 'cancelled']) {
    assert.equal(await inspect({ status, externalRequests: { remote: { mayStillRun: true } } }), true, status);
  }
});

test('exit inspection reads later history pages and propagates storage failures', async () => {
  const calls = [];
  assert.equal(await hasInterruptibleTasks({ call: async (method, params) => {
    calls.push([method, params]);
    return { items: params.offset ? [{ status: 'failed', externalRequests: { remote: { mayStillRun: true } } }]
      : Array.from({ length: 100 }, () => ({ status: 'succeeded' })), hasMore: params.offset === 0 };
  } }), true);
  assert.deepEqual(calls, [['store.list', { limit: 100, offset: 0 }], ['store.list', { limit: 100, offset: 100 }]]);
  const error = new Error('Storage bridge disconnected');
  await assert.rejects(hasInterruptibleTasks({ call: async () => { throw error; } }), value => value === error);
});
