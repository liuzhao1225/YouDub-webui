/** Closed command/result protocol for Runtime operations executed by a Client. */

import type { ClientRemoteObjectHandle } from '../../ids.ts'
import type {
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimeCallArgument,
  RuntimeAwaitPromiseRequest,
  RuntimeCallFunctionRequest,
  RuntimeCompletion,
  RuntimeEvaluateRequest,
  RuntimeGetPropertiesRequest,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
} from '../../../cdp/index.ts'

/** Runtime object serialized with one Client-session handle when retained. */
export type ClientRuntimeRemoteObject = RuntimeRemoteObject<ClientRemoteObjectHandle>

/** Property descriptor whose retained values use Client-session handles. */
export type ClientRuntimePropertyDescriptor = RuntimePropertyDescriptor<ClientRemoteObjectHandle>

/** Internal property descriptor whose retained values use Client-session handles. */
export type ClientRuntimeInternalPropertyDescriptor = RuntimeInternalPropertyDescriptor<ClientRemoteObjectHandle>

/** Exception details whose retained value uses a Client-session handle. */
export type ClientRuntimeExceptionDetails = RuntimeExceptionDetails<ClientRemoteObjectHandle>

/** One argument supplied to a function in the Client realm. */
export type ClientCallArgument = RuntimeCallArgument<ClientRemoteObjectHandle>

/** Evaluate source text in the Client global execution context. */
export interface ClientRuntimeEvaluateCommand extends RuntimeEvaluateRequest {
  readonly op: 'evaluate'
}

/** Enumerate properties of one retained Client object. */
export interface ClientRuntimeGetPropertiesCommand extends RuntimeGetPropertiesRequest<ClientRemoteObjectHandle> {
  readonly op: 'get-properties'
}

/** Invoke a function declaration with Client-local receivers and arguments. */
export interface ClientRuntimeCallFunctionCommand extends RuntimeCallFunctionRequest<ClientRemoteObjectHandle> {
  readonly op: 'call-function'
}

/** Await one retained Client promise. */
export interface ClientRuntimeAwaitPromiseCommand extends RuntimeAwaitPromiseRequest<ClientRemoteObjectHandle> {
  readonly op: 'await-promise'
}

/** Release one retained Client object. */
export interface ClientRuntimeReleaseObjectCommand {
  readonly op: 'release-object'
  readonly handle: ClientRemoteObjectHandle
}

/** Release every Client object retained under one DevTools object group. */
export interface ClientRuntimeReleaseObjectGroupCommand {
  readonly op: 'release-object-group'
  readonly objectGroup: string
}

/** Read names visible in the Client global lexical scope. */
export interface ClientRuntimeGlobalLexicalScopeNamesCommand {
  readonly op: 'global-lexical-scope-names'
}

/** Closed command set implemented by the Client Runtime transport. */
export type ClientRuntimeCommand =
  | ClientRuntimeEvaluateCommand
  | ClientRuntimeGetPropertiesCommand
  | ClientRuntimeCallFunctionCommand
  | ClientRuntimeAwaitPromiseCommand
  | ClientRuntimeReleaseObjectCommand
  | ClientRuntimeReleaseObjectGroupCommand
  | ClientRuntimeGlobalLexicalScopeNamesCommand

/** Shared result of evaluation, function calls, and promise awaiting. */
export type ClientRuntimeCompletion = RuntimeCompletion<ClientRemoteObjectHandle>

/** Result discriminant mirrors the command and prevents cross-method settlement. */
export type ClientRuntimeResult =
  | { readonly op: 'evaluate'; readonly completion: ClientRuntimeCompletion }
  | {
    readonly op: 'get-properties'
    readonly properties: readonly ClientRuntimePropertyDescriptor[]
    readonly internalProperties?: readonly ClientRuntimeInternalPropertyDescriptor[]
    readonly exceptionDetails?: ClientRuntimeExceptionDetails
  }
  | { readonly op: 'call-function'; readonly completion: ClientRuntimeCompletion }
  | { readonly op: 'await-promise'; readonly completion: ClientRuntimeCompletion }
  | { readonly op: 'release-object' }
  | { readonly op: 'release-object-group' }
  | { readonly op: 'global-lexical-scope-names'; readonly names: readonly string[] }

/** Stable transport-level failures distinct from evaluated JavaScript exceptions. */
export interface ClientRuntimeError {
  readonly code: 'invalid-request' | 'object-not-found' | 'unsupported' | 'timeout' | 'result-too-large' | 'internal-error'
  readonly message: string
}
