import test from 'node:test'
import assert from 'node:assert/strict'
import { tsImport } from 'tsx/esm/api'
const { DesktopUpdates } = await tsImport('../src/desktop-updates.ts', import.meta.url)
const { DesktopUpdateSchedule } = await tsImport('../../../vendor/deepseek-harness/source/apps/desktop/src/update-schedule.ts', import.meta.url)
import { resolveDesktopLocale } from '../../../vendor/deepseek-harness/source/apps/desktop/src/locale.ts'

function fixture(response = 1) {
  const dialogs = [], operations = []
  let visible = true
  const coordinator = {
    state: { phase: 'idle' },
    async check() { operations.push('check'); return this.state = { phase: 'ready', version: '0.0.13' } },
    async download(version) { operations.push('download'); return this.state = { phase: 'ready', version } },
    async install(version) { operations.push('install'); return this.state = { phase: 'installing', version } },
  }
  const updates = new DesktopUpdates({ version: '0.0.12', coordinator,
    locale: () => resolveDesktopLocale('zh-CN'), visible: () => visible,
    show: async options => { dialogs.push(options); return { response } },
  })
  return { updates, coordinator, dialogs, operations, visibility: value => { visible = value } }
}

test('background completion prompts once; Later retains the prepared package without installation', async () => {
  const f = fixture()
  await f.updates.check()
  await f.updates.open()
  assert.deepEqual(f.operations, ['check'])
  assert.equal(f.dialogs.length, 1)
  assert.deepEqual(f.dialogs[0].buttons, ['重启更新', '稍后更新'])
  f.updates.promptReady()
  assert.equal(f.dialogs.length, 1)
  assert.equal(f.updates.state.phase, 'ready')
})

test('hidden window defers its one prompt until shown and explicit acceptance installs', async () => {
  const f = fixture(0)
  f.visibility(false)
  await f.updates.check()
  assert.equal(f.dialogs.length, 0)
  f.visibility(true)
  f.updates.promptReady()
  await f.updates.open()
  assert.deepEqual(f.operations, ['check', 'install'])
})

test('manual download retry remains in the app and shows the original verification error', async () => {
  const f = fixture()
  f.coordinator.state = { phase: 'error', failedOperation: 'download', version: '0.0.13' }
  f.coordinator.download = async () => f.coordinator.state = { phase: 'error', failedOperation: 'download', message: 'SHA512 mismatch' }
  await f.updates.open()
  assert.equal(f.dialogs[0].detail, 'SHA512 mismatch')
  assert.equal(f.updates.state.phase, 'error')
})

test('task admission failure stays visible and does not claim installation completed', async () => {
  const f = fixture(0)
  f.coordinator.state = { phase: 'ready', version: '0.0.13' }
  f.coordinator.install = async () => f.coordinator.state = { phase: 'error', failedOperation: 'install', message: 'tasks active' }
  await f.updates.open()
  assert.equal(f.dialogs[1].detail, 'tasks active')
})

test('Harness schedule shares the deadline, backs off visible failures, and stops on disposal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let now = 0, calls = 0, failed = false
  const source = { state: { phase: 'idle' }, async check() {
    calls++; this.state = failed ? { phase: 'error', failedOperation: 'check' } : { phase: 'idle' }; return this.state
  } }
  const scheduler = new DesktopUpdateSchedule(source, { intervalMs: 10_000, maxBackoffMs: 60_000, jitter: 0 }, () => 0.5, () => now)
  t.after(() => scheduler.dispose())
  await scheduler.check()
  await scheduler.check() // focus/resume while not due
  assert.equal(calls, 1)
  failed = true
  await scheduler.check(true)
  assert.equal(calls, 2)
  now = 10_000
  await scheduler.check()
  assert.equal(calls, 2)
  now = 20_000
  await scheduler.check()
  assert.equal(calls, 3)
  scheduler.dispose()
  t.mock.timers.tick(100_000)
  assert.equal(calls, 3)
  await assert.rejects(scheduler.check(), /disposed/)
})
