/**
 * Semantic check of the suspension runtime (`src/polyfill/async-context/als-runtime.ts`): the object the
 * transformed modules call at every suspension point.
 *
 * Scope boundary, and why this file does not need the Node-compatibility layer:
 * `als-runtime.ts` owns no state. It moves snapshots through an injected
 * {@link AlsCausality} face, and the state itself lives in the
 * `node:async_hooks` proxy. So the causality face is stubbed here with a
 * recording double, which makes the *ordering* contract — the part transformed
 * code depends on — directly observable:
 *
 *   - `pause` captures BEFORE suspending (not after), so the snapshot belongs to
 *     the frame that suspended;
 *   - `resume` restores BEFORE returning or rethrowing, so the resumed frame's
 *     first observable act is already in the right context;
 *   - both completion paths do this, which is why the token always fulfills.
 *
 * The shim-backed end of the same contract (does a real AsyncLocalStorage
 * actually fold, do the hooks cover timers) is `als-shim.spec.ts`. This file is
 * the middle layer: the protocol, in isolation.
 */
import { expect, test } from 'vitest'
import { createAlsRuntime, type AlsCausality, type AlsToken } from '../../src/polyfill/async-context/als-runtime.ts'

const check = (label: string, actual: unknown, expected: unknown): void => {
  const [seen, wanted] = [JSON.stringify(actual), JSON.stringify(expected)]
  test(label, () => { expect(seen).toBe(wanted) })
}

/**
 * A causality double standing in for the `node:async_hooks` proxy: one mutable
 * "current store" plus a log, so every snapshot/restore is observable in order.
 */
function recordingCausality(): {
  readonly causality: AlsCausality
  readonly log: string[]
  current: string
} {
  const state = {
    current: 'root',
    log: [] as string[],
    causality: {
      snapshot: (): unknown => {
        state.log.push(`snapshot:${state.current}`)
        return state.current
      },
      restore: (snapshot: unknown): void => {
        state.current = snapshot as string
        state.log.push(`restore:${state.current}`)
      },
    },
  }
  return state
}

// ---------------------------------------------------------------------------
// 1. pause: capture before suspending, and always fulfill.
// ---------------------------------------------------------------------------

{
  const state = recordingCausality()
  const als = createAlsRuntime(state.causality)

  state.current = 'session-A'
  const pending = als.pause('value')
  // The capture is synchronous with the call, before any microtask can run: that
  // is what makes the snapshot belong to the suspending frame.
  check('pause captures synchronously, before suspending', state.log, ['snapshot:session-A'])

  // Something else runs on this thread while the frame is suspended.
  state.current = 'session-B'
  const token = await pending
  check('token reports fulfilment', token.ok, true)
  check('token carries the awaited value', token.value, 'value')
  check('token carries the snapshot taken at pause time', token.snapshot, 'session-A')
  check('pause does not restore by itself', state.current, 'session-B')
}

{
  // A rejection must travel INSIDE the token, so the token itself always
  // fulfills; otherwise `await __als.pause(x)` would throw before `resume` had a
  // chance to restore, and the catch clause would run in the wrong context.
  const state = recordingCausality()
  const als = createAlsRuntime(state.causality)
  state.current = 'session-R'
  const failure = new Error('boom')
  const token = await als.pause(Promise.reject(failure))
  check('a rejection does not reject the token', token.ok, false)
  check('the token carries the error', token.error, failure)
  check('the rejected token still carries the snapshot', token.snapshot, 'session-R')
}

{
  // Non-promise and thenable inputs both work: the rewrite wraps every `await`
  // operand, most of which are not promises.
  const als = createAlsRuntime(recordingCausality().causality)
  check('pause accepts a plain value', (await als.pause(7)).value, 7)
  check('pause accepts a thenable', (await als.pause({ then: (resolve: (v: unknown) => void) => { resolve('t') } })).value, 't')
  const nested = await als.pause(Promise.resolve(Promise.resolve('deep')))
  check('pause unwraps a nested promise', nested.value, 'deep')
}

// ---------------------------------------------------------------------------
// 2. resume: restore before handing control back, on both paths.
// ---------------------------------------------------------------------------

{
  const state = recordingCausality()
  const als = createAlsRuntime(state.causality)

  state.current = 'session-A'
  const token = await als.pause('payload')
  state.current = 'someone-else'
  state.log.length = 0

  const value = als.resume(token)
  check('resume returns the value', value, 'payload')
  check('resume restored the captured snapshot', state.current, 'session-A')
  check('resume restores exactly once', state.log, ['restore:session-A'])
}

{
  // The rejection path restores too, and only then rethrows: a catch clause
  // must observe the caller's store.
  const state = recordingCausality()
  const als = createAlsRuntime(state.causality)
  state.current = 'session-C'
  const failure = new Error('nope')
  const token = await als.pause(Promise.reject(failure))
  state.current = 'someone-else'

  let caught: unknown
  try {
    als.resume(token)
  } catch (reason) {
    caught = reason
  }
  check('resume rethrows the original error', caught, failure)
  check('resume restored the context before rethrowing', state.current, 'session-C')
}

{
  // Two frames suspended at once must not cross: this is the single-threaded
  // shape of the concurrency bug the whole protocol exists to prevent.
  const state = recordingCausality()
  const als = createAlsRuntime(state.causality)

  state.current = 'lane-1'
  const first = als.pause('one')
  state.current = 'lane-2'
  const second = als.pause('two')

  const [tokenA, tokenB] = await Promise.all([first, second])
  state.current = 'root'
  check('interleaved pauses keep their own snapshots', [tokenA.snapshot, tokenB.snapshot], ['lane-1', 'lane-2'])

  als.resume(tokenA)
  check('resuming the first frame restores lane-1', state.current, 'lane-1')
  als.resume(tokenB)
  check('resuming the second frame restores lane-2', state.current, 'lane-2')
}

// ---------------------------------------------------------------------------
// 3. snapshot / afterYield: the generator half.
// ---------------------------------------------------------------------------

{
  const state = recordingCausality()
  const als = createAlsRuntime(state.causality)

  state.current = 'gen-A'
  const captured = als.snapshot()
  check('snapshot returns the current store', captured, 'gen-A')

  // While suspended at a `yield`, the consumer may run anything.
  state.current = 'consumer'
  const sent = als.afterYield(captured, 'sent-value')
  check('afterYield passes the consumer value through unchanged', sent, 'sent-value')
  check('afterYield restores the generator context', state.current, 'gen-A')
}

{
  // afterYield must be transparent to every value shape, including undefined:
  // `yield x` with no `next(v)` sends undefined, and swallowing it would change
  // the generator's observable behaviour.
  const als = createAlsRuntime(recordingCausality().causality)
  check('afterYield passes undefined through', als.afterYield('s', undefined), undefined)
  check('afterYield passes null through', als.afterYield('s', null), null)
  const object = { a: 1 }
  check('afterYield passes an object through by identity', als.afterYield('s', object) === object, true)
}

// ---------------------------------------------------------------------------
// 4. iterator: async sources pass through, sync sources are adapted.
// ---------------------------------------------------------------------------

{
  const als = createAlsRuntime(recordingCausality().causality)

  // An async iterable's own iterator is used directly (no wrapping), so its
  // `return`/`throw` stay whatever the source provided.
  const inner = { next: () => Promise.resolve({ done: true, value: undefined }) }
  const source = { [Symbol.asyncIterator]: () => inner }
  check('an async iterable yields its own iterator', als.iterator(source) === inner, true)
}

{
  const als = createAlsRuntime(recordingCausality().causality)
  // Async-from-sync: a sync iterator whose values are promises must be awaited,
  // because `for await` awaits each value.
  const source = {
    [Symbol.iterator]: () => [Promise.resolve('a'), Promise.resolve('b')][Symbol.iterator](),
  }
  const iterator = als.iterator(source)
  check('sync source step 1 is awaited', await iterator.next(), { done: false, value: 'a' })
  check('sync source step 2 is awaited', await iterator.next(), { done: false, value: 'b' })
  check('sync source reports completion', (await iterator.next()).done, true)
}

{
  const als = createAlsRuntime(recordingCausality().causality)
  // `return()` on the adapter must reach the sync iterator's own `return`,
  // because that is where a generator's `finally` runs.
  let closed = 0
  const source = {
    [Symbol.iterator]: () => ({
      next: () => ({ done: false, value: 1 }),
      return: (sent?: unknown) => {
        closed += 1
        return { done: true, value: sent }
      },
    }),
  }
  const iterator = als.iterator(source)
  await iterator.next()
  const result = await iterator.return?.('bye')
  check('adapter forwards return to the sync iterator', closed, 1)
  check('adapter reports the forwarded return result', result, { done: true, value: 'bye' })
}

{
  const als = createAlsRuntime(recordingCausality().causality)
  // A sync iterator with no `return` must not crash the adapter: plain array
  // iterators have one, but hand-rolled ones often do not.
  const iterator = als.iterator({ [Symbol.iterator]: () => ({ next: () => ({ done: true, value: undefined }) }) })
  check('adapter tolerates a sync iterator without return', await iterator.return?.(undefined), { done: true, value: undefined })
}

{
  const als = createAlsRuntime(recordingCausality().causality)
  // A non-iterable is a programming error in the transformed source, and must be
  // a loud TypeError rather than a silent empty loop.
  const rejects = (label: string, value: unknown): void => {
    let outcome: string
    try {
      als.iterator(value)
      outcome = 'no TypeError'
    } catch (reason) {
      outcome = reason instanceof TypeError ? 'TypeError' : `no TypeError: ${String(reason)}`
    }
    test(label, () => { expect(outcome).toBe('TypeError') })
  }
  rejects('a plain object is not iterable', {})
  rejects('a number is not iterable', 7)
  rejects('null is not iterable', null)
  rejects('undefined is not iterable', undefined)
}

// ---------------------------------------------------------------------------
// 5. close: teardown that cannot itself become the failure.
// ---------------------------------------------------------------------------

{
  const als = createAlsRuntime(recordingCausality().causality)
  let closed = 0
  const iterator = {
    next: () => Promise.resolve({ done: true, value: undefined }),
    return: (): Promise<IteratorResult<unknown>> => {
      closed += 1
      return Promise.resolve({ done: true, value: 'closed' })
    },
  }
  check('close forwards the iterator result', await als.close(iterator), { done: true, value: 'closed' })
  check('close calls return exactly once', closed, 1)
}

{
  const als = createAlsRuntime(recordingCausality().causality)
  // An iterator that throws while closing has nothing left to release, and the
  // loop is already leaving: swallowing keeps the original failure (or the
  // `break`) as the observable outcome instead of masking it with a teardown error.
  const throwing = {
    next: () => Promise.resolve({ done: true, value: undefined }),
    return: (): Promise<IteratorResult<unknown>> => Promise.reject(new Error('teardown exploded')),
  }
  check('close swallows a failing return', await als.close(throwing), undefined)

  const synchronouslyThrowing = {
    next: () => Promise.resolve({ done: true, value: undefined }),
    return: (): Promise<IteratorResult<unknown>> => { throw new Error('teardown exploded synchronously') },
  }
  check('close swallows a synchronously throwing return', await als.close(synchronouslyThrowing), undefined)
}

{
  const als = createAlsRuntime(recordingCausality().causality)
  // No `return` at all: nothing to do, and no crash.
  check('close tolerates an iterator without return', await als.close({ next: () => Promise.resolve({ done: true, value: undefined }) }), undefined)
}

// ---------------------------------------------------------------------------
// 6. The inert runtime. Without a causality face, the rewrite still runs and
//    still hops a microtask, but no state moves. A comparison arm built on this
//    mode must be genuinely inert, or the comparison proves nothing.
// ---------------------------------------------------------------------------

{
  const inert = createAlsRuntime()

  check('inert snapshot is undefined', inert.snapshot(), undefined)

  const token = await inert.pause('value')
  check('inert pause still fulfills with the value', [token.ok, token.value], [true, 'value'])
  check('inert pause carries an undefined snapshot', token.snapshot, undefined)
  check('inert resume still returns the value', inert.resume(token), 'value')

  // Failure semantics must not change with the causality face withheld —
  // otherwise the control arm would differ in error handling as well as in
  // context propagation, and the comparison would prove nothing.
  const failure = new Error('inert boom')
  const rejected = await inert.pause(Promise.reject(failure))
  check('inert pause reports rejection in the token', rejected.ok, false)
  let caught: unknown
  try {
    inert.resume(rejected)
  } catch (reason) {
    caught = reason
  }
  check('inert resume still rethrows', caught, failure)

  check('inert afterYield is still transparent', inert.afterYield(undefined, 'sent'), 'sent')

  // The iterator and close verbs are pure plumbing and must work identically.
  const iterator = inert.iterator({ [Symbol.iterator]: () => ['x'][Symbol.iterator]() })
  check('inert iterator still adapts a sync source', await iterator.next(), { done: false, value: 'x' })
  check('inert close still resolves', await inert.close({ next: () => Promise.resolve({ done: true, value: undefined }) }), undefined)
}

{
  // The one thing the inert arm must NOT do: keep a store alive across a
  // suspension. This is the assertion that gives the control arm its meaning.
  const inert = createAlsRuntime()
  const token = await inert.pause('v')
  const before = inert.snapshot()
  inert.resume(token)
  check('inert resume moves no state', [before, inert.snapshot()], [undefined, undefined])
}

// ---------------------------------------------------------------------------
// 7. The two runtimes are independent instances (the loader builds one per
//    boot, and a stray shared closure would couple them).
// ---------------------------------------------------------------------------

{
  const first = recordingCausality()
  const second = recordingCausality()
  const alsA = createAlsRuntime(first.causality)
  const alsB = createAlsRuntime(second.causality)

  first.current = 'A'
  second.current = 'B'
  const tokenA = await alsA.pause(1)
  const tokenB = await alsB.pause(2)
  check('each runtime captures through its own causality face', [tokenA.snapshot, tokenB.snapshot], ['A', 'B'])

  first.current = 'moved'
  alsA.resume(tokenA)
  check('restoring through one runtime does not touch the other', [first.current, second.current], ['A', 'B'])
}

// ---------------------------------------------------------------------------
// 8. The token shape the transform emits against, pinned as a type-level and
//    runtime contract (the emitted code reads `.ok`, `.value`, `.error`,
//    `.snapshot` directly).
// ---------------------------------------------------------------------------

{
  const als = createAlsRuntime(recordingCausality().causality)
  const fulfilled: AlsToken = await als.pause('v')
  check('a fulfilled token exposes ok/value/snapshot', Object.keys(fulfilled).sort(), ['ok', 'snapshot', 'value'])
  const rejected: AlsToken = await als.pause(Promise.reject(new Error('e')))
  check('a rejected token exposes ok/error/snapshot', Object.keys(rejected).sort(), ['error', 'ok', 'snapshot'])
}
