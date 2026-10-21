/** Validation and normalization of CDP Runtime parameters routed to a Client realm. */

import type { RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import { isJsonValue, isPlainObject, type InspectorJsonValue } from '../../../../shared/json.ts'
import type {
  RuntimeAwaitPromiseRequest,
  RuntimeCallFunctionRequest,
  RuntimeEvaluateRequest,
  RuntimeGetPropertiesRequest,
} from '../../../../shared/cdp/index.ts'
import { exactKeys, optionalBoolean, optionalString } from '../../../../shared/validation.ts'

/** Numeric or globally unique selector for one execution context. */
export interface CdpExecutionContextSelector {
  readonly contextId?: number
  readonly executionContextId?: number
  readonly uniqueContextId?: string
}

/** Validated Runtime.evaluate parameters and their routing selector. */
export interface ParsedEvaluate extends CdpExecutionContextSelector {
  readonly request: RuntimeEvaluateRequest
}

/** Client-independent call argument before object ids are routed. */
export type CdpCallArgument =
  | { readonly kind: 'value'; readonly value: InspectorJsonValue }
  | { readonly kind: 'unserializable'; readonly value: string }
  | { readonly kind: 'object'; readonly objectId: string }
  | { readonly kind: 'undefined' }

/** Validated Runtime.callFunctionOn parameters before object-id routing. */
export interface ParsedCallFunction extends CdpExecutionContextSelector {
  readonly objectId?: string
  readonly arguments: readonly CdpCallArgument[]
  readonly request: Omit<RuntimeCallFunctionRequest<RuntimeBackendObjectHandle>, 'receiver' | 'arguments'>
}

/**
 * Parse realm-routed `Runtime.evaluate` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns A context selector and normalized Runtime request.
 */
export function parseEvaluate(params: Readonly<Record<string, unknown>>): ParsedEvaluate {
  exactKeys(params, [
    'expression', 'objectGroup', 'includeCommandLineAPI', 'silent', 'contextId', 'returnByValue',
    'generatePreview', 'userGesture', 'awaitPromise', 'throwOnSideEffect', 'timeout', 'disableBreaks',
    'replMode', 'allowUnsafeEvalBlockedByCSP', 'uniqueContextId', 'serializationOptions',
  ], 'Runtime.evaluate params')
  if (typeof params.expression !== 'string') throw new Error('Runtime.evaluate expression must be a string')
  const selector = parseContextSelector(params, 'contextId')
  const timeout = params.timeout
  if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0)) {
    throw new Error('Runtime.evaluate timeout must be a non-negative finite number')
  }
  return {
    ...selector,
    request: {
      expression: params.expression,
      ...optionalString(params, 'objectGroup'),
      ...optionalBoolean(params, 'includeCommandLineAPI'),
      ...optionalBoolean(params, 'silent'),
      ...optionalBoolean(params, 'returnByValue'),
      ...optionalBoolean(params, 'generatePreview'),
      ...optionalBoolean(params, 'userGesture'),
      ...optionalBoolean(params, 'awaitPromise'),
      ...optionalBoolean(params, 'disableBreaks'),
      ...optionalBoolean(params, 'replMode'),
      ...optionalBoolean(params, 'allowUnsafeEvalBlockedByCSP'),
      ...optionalBoolean(params, 'throwOnSideEffect'),
      ...optionalJsonObject(params, 'serializationOptions'),
      ...(timeout === undefined ? {} : { timeoutMs: timeout }),
    },
  }
}

/**
 * Parse realm-routed `Runtime.getProperties` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns The external object id and handle-free Runtime request.
 */
export function parseGetProperties(
  params: Readonly<Record<string, unknown>>,
): {
  readonly objectId: string
  readonly request: Omit<RuntimeGetPropertiesRequest<RuntimeBackendObjectHandle>, 'handle'>
} {
  exactKeys(params, [
    'objectId', 'ownProperties', 'accessorPropertiesOnly', 'generatePreview', 'nonIndexedPropertiesOnly',
  ], 'Runtime.getProperties params')
  if (typeof params.objectId !== 'string') throw new Error('Runtime.getProperties objectId must be a string')
  return {
    objectId: params.objectId,
    request: {
      ...optionalBoolean(params, 'ownProperties'),
      ...optionalBoolean(params, 'accessorPropertiesOnly'),
      ...optionalBoolean(params, 'generatePreview'),
      ...optionalBoolean(params, 'nonIndexedPropertiesOnly'),
    },
  }
}

/**
 * Parse Client-routed `Runtime.callFunctionOn` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns Routing fields, arguments, and a handle-free Runtime request.
 */
export function parseCallFunction(params: Readonly<Record<string, unknown>>): ParsedCallFunction {
  exactKeys(params, [
    'functionDeclaration', 'objectId', 'arguments', 'silent', 'returnByValue', 'generatePreview', 'userGesture',
    'awaitPromise', 'executionContextId', 'objectGroup', 'throwOnSideEffect', 'uniqueContextId', 'serializationOptions',
  ], 'Runtime.callFunctionOn params')
  if (typeof params.functionDeclaration !== 'string') {
    throw new Error('Runtime.callFunctionOn functionDeclaration must be a string')
  }
  const selector = parseContextSelector(params, 'executionContextId')
  const objectId = optionalObjectId(params.objectId, 'Runtime.callFunctionOn objectId')
  if (objectId === undefined
    && selector.executionContextId === undefined
    && selector.uniqueContextId === undefined) {
    throw new Error('Runtime.callFunctionOn requires objectId or an execution context')
  }
  if (objectId !== undefined && (selector.executionContextId !== undefined || selector.uniqueContextId !== undefined)) {
    throw new Error('Runtime.callFunctionOn objectId and execution context are mutually exclusive')
  }
  let args: readonly CdpCallArgument[] = []
  if (params.arguments !== undefined) {
    if (!Array.isArray(params.arguments)) throw new Error('Runtime.callFunctionOn arguments must be an array')
    args = params.arguments.map(parseCallArgument)
  }
  return {
    ...selector,
    ...(objectId === undefined ? {} : { objectId }),
    arguments: args,
    request: {
      functionDeclaration: params.functionDeclaration,
      ...optionalString(params, 'objectGroup'),
      ...optionalBoolean(params, 'silent'),
      ...optionalBoolean(params, 'returnByValue'),
      ...optionalBoolean(params, 'generatePreview'),
      ...optionalBoolean(params, 'userGesture'),
      ...optionalBoolean(params, 'awaitPromise'),
      ...optionalBoolean(params, 'throwOnSideEffect'),
      ...optionalJsonObject(params, 'serializationOptions'),
    },
  }
}

/**
 * Parse Client-routed `Runtime.awaitPromise` parameters.
 * @param params - Untrusted CDP parameters.
 * @returns The external promise id and handle-free Runtime request.
 */
export function parseAwaitPromise(params: Readonly<Record<string, unknown>>): {
  readonly promiseObjectId: string
  readonly request: Omit<RuntimeAwaitPromiseRequest<RuntimeBackendObjectHandle>, 'promise'>
} {
  exactKeys(params, ['promiseObjectId', 'returnByValue', 'generatePreview'], 'Runtime.awaitPromise params')
  if (typeof params.promiseObjectId !== 'string') throw new Error('Runtime.awaitPromise promiseObjectId must be a string')
  return {
    promiseObjectId: params.promiseObjectId,
    request: {
      ...optionalBoolean(params, 'returnByValue'),
      ...optionalBoolean(params, 'generatePreview'),
    },
  }
}

/**
 * Parse one required object id.
 * @param params - Untrusted CDP parameters.
 * @returns The object id.
 */
export function parseReleaseObject(params: Readonly<Record<string, unknown>>): string {
  exactKeys(params, ['objectId'], 'Runtime.releaseObject params')
  if (typeof params.objectId !== 'string') throw new Error('Runtime.releaseObject objectId must be a string')
  return params.objectId
}

/**
 * Parse one required object-group name.
 * @param params - Untrusted CDP parameters.
 * @returns The object-group name.
 */
export function parseReleaseObjectGroup(params: Readonly<Record<string, unknown>>): string {
  exactKeys(params, ['objectGroup'], 'Runtime.releaseObjectGroup params')
  if (typeof params.objectGroup !== 'string') throw new Error('Runtime.releaseObjectGroup objectGroup must be a string')
  return params.objectGroup
}

/**
 * Parse `Runtime.globalLexicalScopeNames` context selection.
 * @param params - Untrusted CDP parameters.
 * @returns The validated context selector.
 */
export function parseGlobalLexicalScopeNames(params: Readonly<Record<string, unknown>>): CdpExecutionContextSelector {
  exactKeys(params, ['executionContextId'], 'Runtime.globalLexicalScopeNames params')
  return parseContextSelector(params, 'executionContextId')
}

function parseCallArgument(value: unknown): CdpCallArgument {
  if (!isPlainObject(value)) throw new Error('Runtime.callFunctionOn argument must be an object')
  exactKeys(value, ['value', 'unserializableValue', 'objectId'], 'Runtime.callFunctionOn argument')
  const present = ['value', 'unserializableValue', 'objectId'].filter(key => Object.hasOwn(value, key))
  if (present.length > 1) throw new Error('Runtime.callFunctionOn argument has multiple value representations')
  if (present.length === 0) return { kind: 'undefined' }
  if (present[0] === 'value') {
    if (!isJsonValue(value.value)) throw new Error('Runtime.callFunctionOn argument value must be JSON')
    return { kind: 'value', value: value.value }
  }
  if (present[0] === 'unserializableValue') {
    if (typeof value.unserializableValue !== 'string') {
      throw new Error('Runtime.callFunctionOn unserializableValue must be a string')
    }
    return { kind: 'unserializable', value: value.unserializableValue }
  }
  if (typeof value.objectId !== 'string') throw new Error('Runtime.callFunctionOn argument objectId must be a string')
  return { kind: 'object', objectId: value.objectId }
}

function parseContextSelector(
  params: Readonly<Record<string, unknown>>,
  numericKey: 'contextId' | 'executionContextId',
): CdpExecutionContextSelector {
  const numeric = params[numericKey]
  const unique = params.uniqueContextId
  if (numeric !== undefined && (!Number.isSafeInteger(numeric))) {
    throw new Error(`Runtime ${numericKey} must be an integer`)
  }
  if (unique !== undefined && typeof unique !== 'string') throw new Error('Runtime uniqueContextId must be a string')
  if (numeric !== undefined && unique !== undefined) throw new Error('Runtime context selectors are mutually exclusive')
  return {
    ...(numeric === undefined
      ? {}
      : numericKey === 'contextId'
        ? { contextId: numeric as number }
        : { executionContextId: numeric as number }),
    ...(unique === undefined ? {} : { uniqueContextId: unique }),
  }
}

function optionalObjectId(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  return value
}

function optionalJsonObject<Key extends string>(
  value: Readonly<Record<string, unknown>>,
  key: Key,
): Partial<Record<Key, Readonly<Record<string, InspectorJsonValue>>>> {
  const item = value[key]
  if (item === undefined) return {}
  if (!isPlainObject(item) || !isJsonValue(item)) throw new Error(`Runtime ${key} must be a JSON object`)
  return { [key]: item } as Partial<Record<Key, Readonly<Record<string, InspectorJsonValue>>>>
}
