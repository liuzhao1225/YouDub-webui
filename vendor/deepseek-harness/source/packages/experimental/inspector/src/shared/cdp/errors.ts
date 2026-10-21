/** Realm-neutral JavaScript exception and stack information. */

import type { RuntimeScriptKey } from './ids.ts'
import type { RuntimeRemoteObject } from './remote-object.ts'

/** One source location in a Runtime exception stack. */
export interface RuntimeCallFrame {
  readonly functionName: string
  readonly scriptKey?: RuntimeScriptKey
  readonly url: string
  readonly lineNumber: number
  readonly columnNumber: number
}

/** JavaScript stack information independent of a Debugger script id. */
export interface RuntimeStackTrace {
  readonly description?: string
  readonly callFrames: readonly RuntimeCallFrame[]
  readonly parent?: RuntimeStackTrace
}

/** JavaScript exception produced while executing one Runtime command. */
export interface RuntimeExceptionDetails<Handle extends string> {
  readonly text: string
  readonly lineNumber: number
  readonly columnNumber: number
  readonly url?: string
  readonly stackTrace?: RuntimeStackTrace
  readonly exception?: RuntimeRemoteObject<Handle>
}
