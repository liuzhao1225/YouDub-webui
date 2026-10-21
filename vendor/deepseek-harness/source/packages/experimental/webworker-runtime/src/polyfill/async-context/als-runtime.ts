/**
 * Runtime the transformed modules call at every suspension point.
 *
 * `pause` snapshots every ambient store and hands back a token that **always
 * fulfills** (a rejection travels inside it); `resume` restores that snapshot as
 * the first thing the resumed frame does, then returns the value or rethrows the
 * error, so both completion paths are causally exact. The state itself belongs to
 * the `node:async_hooks` proxy — this module only moves it.
 *
 * The transform that inserts these calls lives in `transform.ts`.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/polyfill/async-context/als-runtime
 */
/** Snapshot of every ambient store, opaque to this module. */
export type AlsSnapshot = unknown

/** Result of a suspension: a rejection travels inside it, so the token always fulfills. */
export interface AlsToken {
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: unknown
  readonly snapshot: AlsSnapshot
}

/** The state face the rewrite moves snapshots through; the shim owns the state itself. */
export interface AlsCausality {
  /** Capture every instance's current store. */
  snapshot(): AlsSnapshot
  /** Restore a captured snapshot. */
  restore(snapshot: AlsSnapshot): void
}

/** Runtime the rewritten modules call; built by {@link createAlsRuntime}. */
export interface AlsRuntime {
  pause(value: unknown): Promise<AlsToken>
  resume(token: AlsToken): unknown
  snapshot(): AlsSnapshot
  afterYield(snapshot: AlsSnapshot, sent: unknown): unknown
  iterator(value: unknown): AsyncIterator<unknown>
  close(iterator: AsyncIterator<unknown>): Promise<unknown>
}

/**
 * Build the runtime the rewritten code calls.
 * @param causality - Snapshot face from the `node:async_hooks` proxy; omitted
 *   leaves the rewrite inert (it still hops a microtask, but moves no state).
 * @returns Runtime object passed to every module wrapper.
 */
export function createAlsRuntime(causality?: AlsCausality): AlsRuntime {
  const snapshot = (): AlsSnapshot => causality?.snapshot()
  const restore = (value: AlsSnapshot): void => { causality?.restore(value) }
  return {
    snapshot,
    pause: (value: unknown): Promise<AlsToken> => {
      const captured = snapshot()
      return Promise.resolve(value).then(
        settled => ({ ok: true, value: settled, snapshot: captured }),
        (error: unknown) => ({ ok: false, error, snapshot: captured }),
      )
    },
    resume: (token: AlsToken): unknown => {
      restore(token.snapshot)
      if (token.ok) return token.value
      throw token.error
    },
    afterYield: (captured: AlsSnapshot, sent: unknown): unknown => {
      restore(captured)
      return sent
    },
    iterator: (value: unknown): AsyncIterator<unknown> => {
      const source = value as {
        [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
        [Symbol.iterator]?: () => Iterator<unknown, unknown>
      }
      const asyncFactory = source[Symbol.asyncIterator]
      if (typeof asyncFactory === 'function') return asyncFactory.call(source)
      const syncFactory = source[Symbol.iterator]
      if (typeof syncFactory !== 'function') {
        throw new TypeError('webworker als: for-await source is neither async nor sync iterable')
      }
      const inner = syncFactory.call(source)
      // Async-from-sync: a sync iterator's values may be promises the loop awaits.
      return {
        next: async (...args: [] | [unknown]): Promise<IteratorResult<unknown>> => {
          const step = inner.next(...args as [unknown])
          return { done: step.done ?? false, value: await step.value }
        },
        return: async (sent?: unknown): Promise<IteratorResult<unknown>> => {
          const step = inner.return?.(sent) ?? { done: true, value: undefined }
          return { done: step.done ?? true, value: await step.value }
        },
      } as AsyncIterator<unknown>
    },
    close: async (iterator: AsyncIterator<unknown>): Promise<unknown> => {
      try {
        return await iterator.return?.(undefined)
      } catch {
        // Closing an iterator that already failed has nothing left to release.
        return undefined
      }
    },
  }
}
