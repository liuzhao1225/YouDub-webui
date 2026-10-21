/** Realm-neutral values used by active debugger backends. */

import type { InspectorJsonValue } from '../json.ts'
import type { RuntimeScriptKey } from './ids.ts'
import type { RuntimeStackTrace } from './errors.ts'
import type { RuntimeCompletion } from './operations.ts'
import type { RuntimeRemoteObject } from './remote-object.ts'

/** One source location independent of a CDP ScriptId allocation policy. */
export interface RuntimeDebuggerLocation {
  readonly scriptKey: RuntimeScriptKey
  readonly lineNumber: number
  readonly columnNumber?: number
}

/** One lexical scope attached to a paused call frame. */
export interface RuntimeDebuggerScope<Handle extends string> {
  readonly type: string
  readonly object: RuntimeRemoteObject<Handle>
  readonly name?: string
  readonly startLocation?: RuntimeDebuggerLocation
  readonly endLocation?: RuntimeDebuggerLocation
}

/** One paused JavaScript call frame. */
export interface RuntimeDebuggerCallFrame<Handle extends string> {
  readonly callFrameId: string
  readonly functionName: string
  readonly functionLocation?: RuntimeDebuggerLocation
  readonly location: RuntimeDebuggerLocation
  readonly url: string
  readonly scopeChain: readonly RuntimeDebuggerScope<Handle>[]
  readonly thisObject: RuntimeRemoteObject<Handle>
  readonly returnValue?: RuntimeRemoteObject<Handle>
}

/** Engine-independent evaluation request for one paused call frame. */
export interface RuntimeCallFrameEvaluationRequest {
  readonly callFrameId: string
  readonly expression: string
  readonly objectGroup?: string
  readonly includeCommandLineAPI?: boolean
  readonly silent?: boolean
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
  readonly throwOnSideEffect?: boolean
  readonly timeoutMs?: number
}

/** Optional native script-cache limit requested while enabling Debugger. */
export interface RuntimeDebuggerEnableRequest {
  readonly maxScriptsCacheSize?: number
}

/** Optional termination requested while resuming a native debugger. */
export interface RuntimeDebuggerResumeRequest {
  readonly terminateOnResume?: boolean
}

/** Debugger lifecycle notification emitted by a realm backend. */
export type RuntimeDebuggerEvent<Handle extends string> =
  | {
    readonly type: 'paused'
    readonly callFrames: readonly RuntimeDebuggerCallFrame<Handle>[]
    readonly reason: string
    readonly data?: InspectorJsonValue
    readonly hitBreakpoints?: readonly string[]
    readonly asyncStackTrace?: RuntimeStackTrace
  }
  | { readonly type: 'resumed' }
  | {
    readonly type: 'breakpoint-resolved'
    readonly breakpointId: string
    readonly location: RuntimeDebuggerLocation
  }

/** Active debugger operation result containing a Runtime value. */
export type RuntimeCallFrameEvaluation<Handle extends string> = RuntimeCompletion<Handle>
