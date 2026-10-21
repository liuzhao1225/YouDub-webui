/**
 * Global hook layer for the ALS shim: capture the async context where a callback
 * is REGISTERED and restore it where the callback RUNS. Together with the folding
 * stack in `./async-hooks.ts` this gives the worker two kinds of coverage —
 * `await` inside a boundary keeps its store because the boundary's stack entry is
 * still open, and work handed to the platform (`.then`, `queueMicrotask`, timers,
 * `fetch`) keeps its store because it was captured at registration.
 *
 * Patched here: `Promise.prototype.then` and `queueMicrotask` and `fetch`. Node's
 * `catch`/`finally` are specified to invoke `then` on the receiver, so they inherit
 * the patch instead of needing their own (`als-check.ts` proves it). The worker's
 * `setTimeout`/`setInterval`/`setImmediate` are bound in `./timers-global.ts`, and
 * the host's `process.nextTick` shim is built on `queueMicrotask`, so both arrive
 * here too.
 *
 * Two properties the patches keep:
 * - the values stay native promises — a handler is wrapped, never the chain, so
 *   `then` still returns what the original returned;
 * - an empty handler slot stays empty (`.then(undefined, onRejected)` must not
 *   grow a fulfilled handler, or a rejection would be swallowed).
 *
 * Not covered (structural): native `async`/`await` resumption is invisible to user
 * code, so the folding stack remains what carries a store across an `await`.
 */
import { bindAsyncContext, captureAsyncContext, runWithAsyncContext } from '../../node/builtin_modules/implemented/async_hooks.ts'

type Handler = ((value: never) => unknown) | null | undefined

let installed = false

/** Wrap one handler slot, leaving a non-function slot exactly as it was. */
const bindSlot = (handler: Handler, snapshot: ReturnType<typeof captureAsyncContext>): Handler => {
  if (typeof handler !== 'function') return handler
  return (value: never) => runWithAsyncContext(snapshot, () => handler(value))
}

/**
 * Patch the platform registration points. Idempotent; call once from the worker
 * entry before the host tree boots.
 */
export function installAsyncContextHooks(): void {
  if (installed) return
  installed = true

  // eslint-disable-next-line @typescript-eslint/unbound-method -- the pristine `then` is `.call`ed on its own promise below
  const nativeThen = Promise.prototype.then
  // A browser has no async-context tracking, so registration points are where a
  // store can be captured at all — patching them is the point of this module.
  Promise.prototype.then = function patchedThen<T, R1, R2>(
    this: Promise<T>,
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    const snapshot = captureAsyncContext()
    if (snapshot === undefined) return nativeThen.call(this, onFulfilled, onRejected) as Promise<R1 | R2>
    return nativeThen.call(
      this,
      bindSlot(onFulfilled as Handler, snapshot) as typeof onFulfilled,
      bindSlot(onRejected as Handler, snapshot) as typeof onRejected,
    ) as Promise<R1 | R2>
  }

  const nativeQueueMicrotask = globalThis.queueMicrotask.bind(globalThis)
  globalThis.queueMicrotask = (callback: VoidFunction): void => {
    nativeQueueMicrotask(bindAsyncContext(callback))
  }

  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const snapshot = captureAsyncContext()
    if (snapshot === undefined) return nativeFetch(input, init)
    // Bind the response continuation to the call site, for consumers that hand
    // the promise on before attaching handlers. `nativeThen` keeps the chain native.
    return nativeThen.call(
      nativeFetch(input, init),
      (response: Response) => runWithAsyncContext(snapshot, () => response),
      (reason: unknown) => runWithAsyncContext(snapshot, () => { throw reason }),
    ) as Promise<Response>
  })
}
