/**
 * `node:perf_hooks`: the worker's own high-resolution clock.
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

const MODULE = 'node:perf_hooks'

/** Same clock object the worker global exposes. */
export const performance = globalThis.performance

/** Observation of performance entries has no consumer here. */
export const PerformanceObserver: typeof import('node:perf_hooks').PerformanceObserver
  = notImplementedFail(MODULE, 'PerformanceObserver')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/**
 * The `node:perf_hooks` declarations this module stands in for. `performance`
 * keeps the worker's own clock: Node declares its clock with `nodeTiming`,
 * `timerify`, and event-loop utilization, none of which a browser `Performance`
 * object carries.
 */
type NodeFace = Partial<Omit<typeof import('node:perf_hooks'), 'performance'>> & Record<'performance', unknown>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { performance, PerformanceObserver } satisfies NodeFace
