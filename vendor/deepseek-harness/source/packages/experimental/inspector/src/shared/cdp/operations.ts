/** Realm-neutral Runtime operations and results. */

import type { InspectorJsonObject, InspectorJsonValue } from '../json.ts'
import type { RuntimeExceptionDetails } from './errors.ts'
import type {
  RuntimeInternalPropertyDescriptor,
  RuntimePrivatePropertyDescriptor,
  RuntimePropertyDescriptor,
} from './property.ts'
import type { RuntimeRemoteObject } from './remote-object.ts'

/** One argument supplied to a function in an inspected realm. */
export type RuntimeCallArgument<Handle extends string> =
  | { readonly kind: 'value'; readonly value: InspectorJsonValue }
  | { readonly kind: 'unserializable'; readonly value: string }
  | { readonly kind: 'object'; readonly handle: Handle }
  | { readonly kind: 'undefined' }

/** Backend-local selector for a native execution context within one realm. */
export type RuntimeExecutionContext =
  | { readonly kind: 'numeric'; readonly id: number }
  | { readonly kind: 'unique'; readonly id: string }

/** Engine-independent evaluation options supported by Runtime backends. */
export interface RuntimeEvaluateRequest {
  readonly expression: string
  readonly context?: RuntimeExecutionContext
  readonly objectGroup?: string
  readonly includeCommandLineAPI?: boolean
  readonly silent?: boolean
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
  readonly userGesture?: boolean
  readonly awaitPromise?: boolean
  readonly disableBreaks?: boolean
  readonly replMode?: boolean
  readonly allowUnsafeEvalBlockedByCSP?: boolean
  readonly throwOnSideEffect?: boolean
  readonly serializationOptions?: InspectorJsonObject
  readonly timeoutMs?: number
}

/** Property enumeration request for one backend object. */
export interface RuntimeGetPropertiesRequest<Handle extends string> {
  readonly handle: Handle
  readonly ownProperties?: boolean
  readonly accessorPropertiesOnly?: boolean
  readonly generatePreview?: boolean
  readonly nonIndexedPropertiesOnly?: boolean
}

/** Function invocation request within one inspected realm. */
export interface RuntimeCallFunctionRequest<Handle extends string> {
  readonly functionDeclaration: string
  readonly context?: RuntimeExecutionContext
  readonly receiver?: Handle
  readonly arguments?: readonly RuntimeCallArgument<Handle>[]
  readonly objectGroup?: string
  readonly silent?: boolean
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
  readonly userGesture?: boolean
  readonly awaitPromise?: boolean
  readonly throwOnSideEffect?: boolean
  readonly serializationOptions?: InspectorJsonObject
}

/** Promise-await request for one retained backend object. */
export interface RuntimeAwaitPromiseRequest<Handle extends string> {
  readonly promise: Handle
  readonly returnByValue?: boolean
  readonly generatePreview?: boolean
}

/** Shared result of evaluation, function calls, and promise awaiting. */
export interface RuntimeCompletion<Handle extends string> {
  readonly result: RuntimeRemoteObject<Handle>
  readonly exceptionDetails?: RuntimeExceptionDetails<Handle>
}

/** Shared result of property enumeration. */
export interface RuntimeProperties<Handle extends string> {
  readonly properties: readonly RuntimePropertyDescriptor<Handle>[]
  readonly internalProperties?: readonly RuntimeInternalPropertyDescriptor<Handle>[]
  readonly privateProperties?: readonly RuntimePrivatePropertyDescriptor<Handle>[]
  readonly exceptionDetails?: RuntimeExceptionDetails<Handle>
}
