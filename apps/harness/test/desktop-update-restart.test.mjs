import test from 'node:test'
import assert from 'node:assert/strict'
import { tsImport } from 'tsx/esm/api'
const { prepareDesktopUpdateRestart } = await tsImport('../src/desktop-update-restart.ts', import.meta.url)

test('running work and unknown inspection stop the restart before closing the editor or Host', async () => {
  for (const failure of [true, new Error('storage offline')]) {
    const calls = []
    await assert.rejects(prepareDesktopUpdateRestart({
      tasks: async action => { calls.push(action); if (action === 'lock') { if (failure instanceof Error) throw failure; return true } return false },
      closeRenderer: async () => { calls.push('close'); return true }, stop: async () => { calls.push('stop') }, activeMessage: 'tasks active',
    }), failure instanceof Error ? /storage offline/ : /tasks active/)
    assert.deepEqual(calls, ['lock', 'unlock'])
  }
})

test('unsaved editor cancellation releases admission; clean restart stops Host after editor closes', async () => {
  for (const approved of [false, true]) {
    const calls = []
    assert.equal(await prepareDesktopUpdateRestart({ tasks: async action => { calls.push(action); return false },
      closeRenderer: async () => { calls.push('close'); return approved }, stop: async () => { calls.push('stop') }, activeMessage: 'tasks active' }), approved)
    assert.deepEqual(calls, approved ? ['lock', 'close', 'stop'] : ['lock', 'close', 'unlock'])
  }
})

test('unclean stop propagates its original error, including when releasing admission also fails', async () => {
  const original = new Error('Host failed graceful teardown')
  const options = { tasks: async () => false, closeRenderer: async () => true, stop: async () => { throw original }, activeMessage: 'tasks active' }
  await assert.rejects(prepareDesktopUpdateRestart(options), error => error === original)
  await assert.rejects(prepareDesktopUpdateRestart({ ...options, tasks: async action => { if (action === 'unlock') throw new Error('Host exited'); return false } }),
    error => error instanceof AggregateError && error.errors[0] === original && error.message.includes('Host exited'))
})
