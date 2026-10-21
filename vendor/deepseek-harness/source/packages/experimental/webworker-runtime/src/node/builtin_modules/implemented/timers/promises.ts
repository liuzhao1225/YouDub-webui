/**
 * `node:timers/promises`: real implementations over the worker's timer globals.
 */
import type { TimerOptions } from 'node:timers'

/** The rejection an aborted wait reports, as Node and the DOM both spell it. */
const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError')

/**
 * Resolve after a delay.
 * @param delayMs - milliseconds to wait.
 * @param value - value to resolve with; Node resolves undefined when none is handed in.
 * @param options - abort support, as Node provides.
 * @returns the value after the delay, or a rejection when the signal aborts.
 */
export function setTimeout<T = void>(
  delayMs?: number,
  value?: T,
  options?: TimerOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    // A signal that has already aborted emits no further `abort` event, so the
    // timer must not be armed at all; Node rejects such a call straight away.
    if (options?.signal?.aborted === true) {
      reject(abortError())
      return
    }
    const timer = globalThis.setTimeout(() => { resolve(value as T) }, delayMs)
    options?.signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timer)
      reject(abortError())
    }, { once: true })
  })
}

/**
 * Resolve on the next macrotask.
 * @param value - resolution value handed back after the timer.
 * @returns a promise resolved after a zero-delay timer.
 */
export function setImmediate<T = void>(value?: T): Promise<T> {
  return setTimeout(0, value)
}

/** Cooperative scheduling helpers Node exposes on this module. */
export const scheduler = {
  wait: async (delayMs?: number, options?: TimerOptions): Promise<void> => {
    await setTimeout(delayMs, undefined, options)
  },
  yield: async (): Promise<void> => { await setTimeout(0) },
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** The `node:timers/promises` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:timers/promises')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { setTimeout, setImmediate, scheduler } satisfies NodeFace
