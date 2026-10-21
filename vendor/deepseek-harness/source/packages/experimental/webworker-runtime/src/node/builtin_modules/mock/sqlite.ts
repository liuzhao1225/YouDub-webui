/**
 * `node:sqlite` stub. The web profile configures session-query-sqlite with
 * `:memory:` and `openAt: never`, so no database is opened during the acceptance
 * chain; reaching the constructor means that configuration changed.
 */
import { notAvailableError, notImplementedFail } from '../../notImplementedFail.ts'

const MODULE = 'node:sqlite'

/** Synchronous database handle (unavailable). */
export const DatabaseSync: typeof import('node:sqlite').DatabaseSync = notImplementedFail(MODULE, 'DatabaseSync')

/** Prepared statement handle (unavailable). */
export const StatementSync: typeof import('node:sqlite').StatementSync = notImplementedFail(MODULE, 'StatementSync')

/**
 * Backup helper (unavailable).
 * @returns Never — it throws naming the unavailable member.
 */
export function backup(): never {
  throw notAvailableError(MODULE, 'backup')
}

/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** The `node:sqlite` declarations this module stands in for. */
type NodeFace = Partial<typeof import('node:sqlite')>

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default { DatabaseSync, StatementSync, backup } satisfies NodeFace
