/**
 * `node:util/types` face: the predicate subset, re-exported from the util shim so
 * both specifiers share one implementation. The predicates are checked against
 * Node where they are built, on `types` in `../util.ts`.
 */
import { types } from '../util.ts'

/** The `node:util/types` predicates the harness reads, shared with the util shim. */
export const { isPromise, isDate, isRegExp, isTypedArray } = types

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

export default types
