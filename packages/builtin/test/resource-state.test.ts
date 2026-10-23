import test from 'node:test'
import assert from 'node:assert/strict'
import { resourceEntries, mergeResourceEntries, type ResourceFacts } from '../../sdk/src/resource-state.js'

const facts = (): ResourceFacts => ({ status: 'missing', environment: [{ id: 'python', name: 'Python', status: 'ready' }, { id: 'acceleration', name: 'Torch', status: 'pending' }],
  models: [{ id: 'whisper', name: 'Whisper', status: 'ready', received: 100, total: 100 }],
  requirements: [{ providerId: 'whisper', resourceId: 'whisper', name: 'Whisper', downloadId: 'whisper', ready: false, automatic: true, dependencies: ['python', 'acceleration'], reason: 'Missing Torch' }] })

test('complete model files remain unavailable until their dependencies pass inspection', () => {
  const state = facts(), entries = resourceEntries(state)
  assert.equal(entries.find(item => item.id === 'whisper')!.status, 'missing')
  assert.deepEqual(entries.find(item => item.id === 'whisper')!.actions, ['prepare'])
  state.environment![1].status = 'ready'; state.status = 'preparing'
  assert.equal(resourceEntries(state).find(item => item.id === 'whisper')!.phase, 'verifying')
  state.requirements![0].ready = true; state.status = 'ready'
  assert.equal(resourceEntries(state).find(item => item.id === 'whisper')!.status, 'ready')
})
test('dependency errors block consumers without claiming the model download failed', () => {
  const state = facts(); Object.assign(state.environment![1], { status: 'failed', detail: 'pip exited 1: disk full' })
  const entries = resourceEntries(state)
  assert.equal(entries[1].status, 'failed')
  assert.equal(entries[2].status, 'blocked')
  assert.equal(entries[2].error, 'pip exited 1: disk full')
  assert.equal(state.models![0].status, 'ready')
})
test('paused and failed downloads survive subsequent resource inspection', () => {
  const state = facts(); state.status = 'preparing'; state.models![0].status = 'paused'
  assert.deepEqual(resourceEntries(state).at(-1)?.actions, ['resume'])
  state.models![0].status = 'failed'; state.models![0].error = 'checksum mismatch'
  assert.equal(resourceEntries(state).at(-1)?.status, 'failed')
  assert.equal(resourceEntries(state).at(-1)?.error, 'checksum mismatch')
})
test('unrelated preparation only replaces the entries it owns', () => {
  const before = resourceEntries(facts()), active = [{ ...before[0], status: 'preparing' as const }]
  assert.deepEqual(mergeResourceEntries(before, active), [active[0], ...before.slice(1)])
  assert.deepEqual(mergeResourceEntries(before, [{ ...before[1], status: 'ready' }]), before)
})
