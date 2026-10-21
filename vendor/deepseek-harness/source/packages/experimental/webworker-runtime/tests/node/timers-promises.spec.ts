/**
 * `node:timers/promises` over the worker's timer globals.
 *
 * The abort paths are the substance. Harness code hands these waits a
 * cancellation signal, and an already-aborted signal emits no further `abort`
 * event — so a wait that only subscribes runs its full delay before answering,
 * which is a cancelled operation that still costs its timeout. The delays below
 * are a minute long on purpose: any case that waited would fail by timing out
 * rather than pass slowly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduler, setImmediate, setTimeout } from '../../src/node/builtin_modules/implemented/timers/promises.ts'

afterEach(() => { vi.restoreAllMocks() })

/** The rejection reason, however the wait failed. */
const rejectionOf = async (pending: Promise<unknown>): Promise<unknown> =>
  await pending.then(() => undefined, (error: unknown) => error)

describe('setTimeout', () => {
  it('resolves with the value after the delay, and undefined without one', async () => {
    await expect(setTimeout(1, 'done')).resolves.toBe('done')
    await expect(setTimeout(1)).resolves.toBeUndefined()
  })

  it('rejects an already-aborted signal without arming a timer', async () => {
    const armed = vi.spyOn(globalThis, 'setTimeout')
    const pending = setTimeout(60_000, 'never', { signal: AbortSignal.abort() })
    // Asserted before any await, so nothing else could have armed a timer here.
    expect(armed).not.toHaveBeenCalled()
    expect(await rejectionOf(pending)).toMatchObject({ name: 'AbortError' })
  })

  it('rejects and releases the timer when the signal aborts while pending', async () => {
    const cleared = vi.spyOn(globalThis, 'clearTimeout')
    const controller = new AbortController()
    const pending = setTimeout(60_000, 'never', { signal: controller.signal })
    controller.abort()
    expect(await rejectionOf(pending)).toMatchObject({ name: 'AbortError' })
    expect(cleared).toHaveBeenCalled()
  })
})

describe('the rest of the face', () => {
  it('resolves setImmediate on a later macrotask with its value', async () => {
    await expect(setImmediate('now')).resolves.toBe('now')
  })

  it('settles both scheduler helpers and forwards the signal through wait', async () => {
    await expect(scheduler.wait(1)).resolves.toBeUndefined()
    await expect(scheduler.yield()).resolves.toBeUndefined()
    const aborted = scheduler.wait(60_000, { signal: AbortSignal.abort() })
    expect(await rejectionOf(aborted)).toMatchObject({ name: 'AbortError' })
  })
})
