import test from 'node:test'
import assert from 'node:assert/strict'
import { tsImport } from 'tsx/esm/api'
const { DesktopUpdates } = await tsImport('../src/desktop-updates.ts', import.meta.url)
const { DesktopUpdateSchedule } = await tsImport('../../../vendor/deepseek-harness/source/apps/desktop/src/update-schedule.ts', import.meta.url)
import { resolveDesktopLocale } from '../../../vendor/deepseek-harness/source/apps/desktop/src/locale.ts'

const available = { version: '0.0.9', download: 'https://github.com/liuzhao1225/YouDub-webui/releases/download/v0.0.9/YouDub-0.0.9-macOS-arm64.dmg' }
function fixture(check, response = 1) {
  const states = [], dialogs = [], links = []
  const updates = new DesktopUpdates({ version: '0.0.8', check, publish: state => states.push(state),
    locale: () => resolveDesktopLocale('zh-CN'),
    show: async options => { dialogs.push(options); return { response } },
    openExternal: async url => { links.push(url) },
  })
  return { updates, states, dialogs, links }
}

test('automatic and manual callers share a check; only confirmed user action opens the installer', async () => {
  let finish, calls = 0
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve }) }, 0)
  const first = f.updates.check(), joined = f.updates.check()
  assert.equal(first, joined)
  await Promise.resolve()
  finish({ available })
  await first
  assert.equal(calls, 1)
  assert.deepEqual(f.states.map(state => state.phase), ['checking', 'available'])
  assert.deepEqual(f.dialogs, [])
  assert.deepEqual(f.links, [])
  const open = f.updates.open(() => Promise.resolve(f.updates.state))
  assert.equal(open, f.updates.open(() => { throw new Error('duplicate dialog') }))
  await open
  assert.deepEqual(f.links, [available.download])
  assert.match(f.dialogs[0].title, /YouDub/)
})

test('later and up-to-date results never open a download', async () => {
  const f = fixture(async () => ({ available }))
  await f.updates.open(() => f.updates.check())
  assert.deepEqual(f.links, [])
  const current = fixture(async () => ({ available: null }))
  await current.updates.open(() => current.updates.check())
  assert.equal(current.updates.state.phase, 'idle')
  assert.equal(current.dialogs[0].message, '已是最新版本')
  assert.deepEqual(current.links, [])
})

test('failed checks expose the original error and clear stale availability', async t => {
  t.mock.method(console, 'error', () => {})
  let failed = false
  const f = fixture(async () => { if (failed) throw new Error('HTTP 503'); return { available } })
  await f.updates.check()
  failed = true
  await f.updates.open(() => f.updates.check())
  assert.equal(f.updates.state.phase, 'error')
  assert.equal(f.dialogs[0].detail, 'HTTP 503')
  assert.deepEqual(f.links, [])
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
