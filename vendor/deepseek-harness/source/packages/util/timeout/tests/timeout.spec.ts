import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  idleWatchdog,
  MAX_TIMER_DELAY_MS,
  timeoutOf,
  TimeoutReason,
} from '@deepseek-ai/dsh-timeout'

describe('TimeoutReason', () => {
  it('is an Error carrying the code and elapsed ms', () => {
    const reason = new TimeoutReason('BASH_TIMEOUT', 100)
    expect(reason).toBeInstanceOf(Error)
    expect(reason.name).toBe('TimeoutReason')
    expect(reason.code).toBe('BASH_TIMEOUT')
    expect(reason.message).toBe('BASH_TIMEOUT after 100ms')
  })
})

describe('timeoutOf', () => {
  it('classifies a bare reason carrier that holds a TimeoutReason', () => {
    const reason = new TimeoutReason('WEB_FETCH_TIMEOUT', 50)
    expect(timeoutOf({ reason })).toBe(reason)
  })

  it('returns undefined for a non-timeout reason', () => {
    expect(timeoutOf({ reason: new Error('other') })).toBeUndefined()
    expect(timeoutOf({ reason: 'user cancelled' })).toBeUndefined()
    expect(timeoutOf({})).toBeUndefined()
  })

  it('matches only the requested code when one is given', () => {
    const reason = new TimeoutReason('BASH_TIMEOUT', 100)
    expect(timeoutOf({ reason }, 'BASH_TIMEOUT')).toBe(reason)
    expect(timeoutOf({ reason }, 'WEB_FETCH_TIMEOUT')).toBeUndefined()
  })
})

describe('idleWatchdog', () => {
  afterEach(() => { vi.useRealTimers() })

  it('arms only while next is outstanding and rearms the same signal for later demand', async () => {
    vi.useFakeTimers()
    const first = Promise.withResolvers<IteratorResult<number>>()
    const second = Promise.withResolvers<IteratorResult<number>>()
    const iterator: AsyncIterator<number> = {
      next: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    }
    using watchdog = idleWatchdog(undefined, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    const stableSignal = watchdog.signal

    const firstNext = watchdog.next(iterator)
    await vi.advanceTimersByTimeAsync(99)
    expect(stableSignal.aborted).toBe(false)
    first.resolve({ done: false, value: 1 })
    await expect(firstNext).resolves.toEqual({ done: false, value: 1 })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(stableSignal.aborted).toBe(false)
    expect(watchdog.signal).toBe(stableSignal)

    const secondNext = watchdog.next(iterator)
    // Observe before advancing: the deadline rejects an iterator that never settles.
    const secondOutcome = secondNext.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(100)
    expect(timeoutOf(stableSignal, 'LLM_STREAM_IDLE_TIMEOUT')).toMatchObject({ code: 'LLM_STREAM_IDLE_TIMEOUT', message: 'LLM_STREAM_IDLE_TIMEOUT after 100ms' })
    second.reject(stableSignal.reason)
    expect(await secondOutcome).toBe(stableSignal.reason)
  })

  it('keeps an earlier upstream abort distinct from its own timeout', async () => {
    vi.useFakeTimers()
    const upstream = new AbortController()
    using watchdog = idleWatchdog(upstream.signal, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    upstream.abort('caller cancelled')
    expect(watchdog.signal.aborted).toBe(true)
    expect(timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(watchdog.signal.reason).toBe('caller cancelled')
  })

  it('clears an outstanding arm on disposal', async () => {
    vi.useFakeTimers()
    const pending = Promise.withResolvers<IteratorResult<number>>()
    const watchdog = idleWatchdog(undefined, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    void watchdog.next({ next: () => pending.promise })
    watchdog[Symbol.dispose]()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(watchdog.signal.aborted).toBe(false)
    pending.resolve({ done: true, value: undefined })
    await expect(watchdog.next({ next: () => Promise.resolve({ done: true, value: undefined }) }))
      .rejects.toThrow(/disposed/)
    watchdog[Symbol.dispose]()
  })

  it('rejects an outstanding demand the iterator never settles', async () => {
    vi.useFakeTimers()
    using watchdog = idleWatchdog(undefined, 100, 'LLM_STREAM_IDLE_TIMEOUT')
    // A transport can leave an aborted read pending forever; the deadline, not the
    // iterator, decides when this demand ends.
    const next = watchdog.next({ next: () => new Promise<IteratorResult<number>>(() => {}) })
    const outcome = next.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(100)
    expect(await outcome).toBe(watchdog.signal.reason)
    expect(timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')).toMatchObject({ code: 'LLM_STREAM_IDLE_TIMEOUT', message: 'LLM_STREAM_IDLE_TIMEOUT after 100ms' })
  })

  it('rejects invalid bounds and concurrent iterator demand', async () => {
    expect(() => idleWatchdog(undefined, 0, 'IDLE')).toThrow(/positive finite/)
    expect(() => idleWatchdog(undefined, Number.NaN, 'IDLE')).toThrow(/positive finite/)
    expect(() => idleWatchdog(undefined, MAX_TIMER_DELAY_MS + 1, 'IDLE'))
      .toThrow(`no greater than ${MAX_TIMER_DELAY_MS}`)
    const pending = Promise.withResolvers<IteratorResult<number>>()
    using watchdog = idleWatchdog(undefined, 100, 'IDLE')
    const iterator = { next: () => pending.promise }
    void watchdog.next(iterator)
    await expect(watchdog.next(iterator)).rejects.toThrow(/already outstanding/)
    pending.resolve({ done: true, value: undefined })
  })
})
