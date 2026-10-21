/** Explicit operation support advertised by each Inspector realm. */

/** Runtime operations implemented by a realm backend. */
export type RuntimeOperation =
  | 'evaluate'
  | 'get-properties'
  | 'call-function'
  | 'await-promise'
  | 'release-object'
  | 'release-object-group'
  | 'global-lexical-scope-names'

/** Console operations implemented by a realm backend. */
export type ConsoleOperation = 'events' | 'exceptions' | 'clear'

/** Source catalog operations implemented by a realm backend. */
export type SourceOperation = 'catalog' | 'content' | 'source-map'

/** Active debugger operations implemented by a realm backend. */
export type DebuggerOperation = 'breakpoint' | 'pause' | 'resume' | 'step' | 'call-frame'

/** Complete capability declaration for one inspected realm. */
export interface InspectorRealmCapabilities {
  readonly runtime: readonly RuntimeOperation[]
  readonly console: readonly ConsoleOperation[]
  readonly sources: readonly SourceOperation[]
  readonly debugger: readonly DebuggerOperation[]
}
