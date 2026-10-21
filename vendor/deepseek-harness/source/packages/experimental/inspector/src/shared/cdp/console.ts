/** Realm-neutral Console events emitted by Runtime backends. */

import type { RuntimeRemoteObject } from './remote-object.ts'
import type { RuntimeExceptionDetails, RuntimeStackTrace } from './errors.ts'

/** Console API categories exposed by CDP Runtime. */
export type RuntimeConsoleType =
  | 'log'
  | 'debug'
  | 'info'
  | 'error'
  | 'warning'
  | 'dir'
  | 'dirxml'
  | 'table'
  | 'trace'
  | 'clear'
  | 'startGroup'
  | 'startGroupCollapsed'
  | 'endGroup'
  | 'assert'
  | 'profile'
  | 'profileEnd'
  | 'count'
  | 'timeEnd'

/** One Console event associated with a single inspected realm. */
export interface RuntimeConsoleEvent<Handle extends string> {
  readonly type: RuntimeConsoleType
  readonly arguments: readonly RuntimeRemoteObject<Handle>[]
  readonly timestamp: number
  readonly contextId?: number
  readonly stackTrace?: RuntimeStackTrace
}

/** One uncaught exception observed in an inspected realm. */
export interface RuntimeExceptionEvent<Handle extends string> {
  readonly timestamp: number
  readonly contextId?: number
  readonly details: RuntimeExceptionDetails<Handle>
}

/** Console-domain event emitted by a realm backend. */
export type RuntimeConsoleBackendEvent<Handle extends string> =
  | { readonly type: 'console-api'; readonly event: RuntimeConsoleEvent<Handle> }
  | { readonly type: 'exception'; readonly event: RuntimeExceptionEvent<Handle> }
