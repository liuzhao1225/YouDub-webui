/**
 * Sync-stack AsyncLocalStorage semantics plus the causality faces the module
 * loader's `await` rewriting consumes: run boundaries, ambient snapshots, and
 * the context root the tunnel dispatches at.
 */
import { describe, expect, it } from 'vitest'
import {
  AsyncLocalStorage, alsCausality, captureAsyncContext, runAtAsyncContextRoot, runWithAsyncContext,
} from '../../src/node/builtin_modules/implemented/async_hooks.ts'

describe('AsyncLocalStorage', () => {
  it('publishes the store inside run and clears it outside', () => {
    const als = new AsyncLocalStorage<string>()
    expect(als.getStore()).toBeUndefined()
    const returned = als.run('inner', () => {
      expect(als.getStore()).toBe('inner')
      return 42
    })
    expect(returned).toBe(42)
    expect(als.getStore()).toBeUndefined()
  })

  it('shadows and restores across nested boundaries', () => {
    const als = new AsyncLocalStorage<string>()
    als.run('outer', () => {
      expect(als.getStore()).toBe('outer')
      als.run('inner', () => { expect(als.getStore()).toBe('inner') })
      expect(als.getStore()).toBe('outer')
    })
  })

  it('keeps the store visible until a returned promise settles', async () => {
    const als = new AsyncLocalStorage<string>()
    let during: string | undefined
    await als.run('async', async () => {
      await Promise.resolve()
      during = als.getStore()
    })
    expect(during).toBe('async')
  })
})

describe('causality faces', () => {
  it('captures a context and republishes it inside runWithAsyncContext', () => {
    const als = new AsyncLocalStorage<string>()
    let snapshot: ReturnType<typeof captureAsyncContext>
    als.run('captured', () => { snapshot = captureAsyncContext() })
    expect(als.getStore()).toBeUndefined()
    runWithAsyncContext(snapshot, () => {
      expect(als.getStore()).toBe('captured')
    })
    expect(als.getStore()).toBeUndefined()
  })

  it('restores every live instance through the alsCausality pair', () => {
    const first = new AsyncLocalStorage<string>()
    const second = new AsyncLocalStorage<number>()
    let paused: ReturnType<typeof alsCausality.snapshot> | undefined
    first.run('a', () => {
      second.run(7, () => { paused = alsCausality.snapshot() })
    })
    expect(first.getStore()).toBeUndefined()
    expect(second.getStore()).toBeUndefined()
    // The rewriting calls restore at a resume point with no place for a
    // disposer; the published context answers reads after the await.
    alsCausality.restore(paused!)
    expect(first.getStore()).toBe('a')
    expect(second.getStore()).toBe(7)
    // A fresh boundary still wins over the resumed ambient context.
    first.run('b', () => { expect(first.getStore()).toBe('b') })
  })

  it('dispatches at the context root without inheriting the caller boundary', () => {
    const als = new AsyncLocalStorage<string>()
    als.run('caller', () => {
      runAtAsyncContextRoot(() => {
        expect(als.getStore()).toBeUndefined()
      })
      expect(als.getStore()).toBe('caller')
    })
  })
})
