/**
 * `node:vm` stub. Script compilation in a separate realm has no browser
 * counterpart; the self-modification and workflow rows mount and report the gap
 * when they try to compile.
 */
import { notImplementedFail } from '../../notImplementedFail.ts'

const MODULE = 'node:vm'

/** Compiled script (unavailable). */
export const Script: typeof import('node:vm').Script = notImplementedFail(MODULE, 'Script')

/** Context creation (unavailable). */
export const createContext: typeof import('node:vm').createContext = notImplementedFail(MODULE, 'createContext')

/** In-context evaluation (unavailable). */
export const runInContext: typeof import('node:vm').runInContext = notImplementedFail(MODULE, 'runInContext')

/** New-context evaluation (unavailable). */
export const runInNewContext: typeof import('node:vm').runInNewContext = notImplementedFail(MODULE, 'runInNewContext')

/** This-context evaluation (unavailable). */
export const runInThisContext: typeof import('node:vm').runInThisContext = notImplementedFail(MODULE, 'runInThisContext')

/** Context predicate (unavailable). */
export const isContext: typeof import('node:vm').isContext = notImplementedFail(MODULE, 'isContext')

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** The `node:vm` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:vm')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  Script, createContext, runInContext, runInNewContext, runInThisContext, isContext,
} satisfies NodeFace
