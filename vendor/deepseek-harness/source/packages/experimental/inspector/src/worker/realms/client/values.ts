/** Conversion from Client wire values to realm-neutral Runtime values. */

import type {
  ClientRuntimeExceptionDetails,
  ClientRuntimePropertyDescriptor,
  ClientRuntimeRemoteObject,
  ClientRuntimeResult,
} from '../../../shared/bridge/messages/runtime/index.ts'
import {
  type ClientRemoteObjectHandle,
} from '../../../shared/bridge/ids.ts'
import { inspectorId } from '../../../shared/identity.ts'
import type { RuntimeBackendObjectHandle, RuntimeScriptKey } from '../../../shared/cdp/ids.ts'
import type {
  RuntimeCompletion,
  RuntimeConsoleBackendEvent,
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
  RuntimeStackTrace,
} from '../../../shared/cdp/index.ts'

/** Maps a Client-local script key into its realm-wide Runtime identity. */
export type ClientScriptKeyMapper = (scriptKey: RuntimeScriptKey) => RuntimeScriptKey

/**
 * Convert one Client completion and all nested objects.
 * @param result - Successful Client Runtime command result.
 * @param mapScriptKey - Realm-wide script identity mapper.
 * @returns A realm-neutral Runtime completion.
 */
export function clientCompletion(
  result: Extract<ClientRuntimeResult, { op: 'evaluate' | 'call-function' | 'await-promise' }>,
  mapScriptKey: ClientScriptKeyMapper,
): RuntimeCompletion<RuntimeBackendObjectHandle> {
  return {
    result: clientRemoteObject(result.completion.result),
    ...(result.completion.exceptionDetails === undefined
      ? {}
      : { exceptionDetails: clientException(result.completion.exceptionDetails, mapScriptKey) }),
  }
}

/**
 * Convert one Client property descriptor and all nested objects.
 * @param value - Client wire property descriptor.
 * @returns A realm-neutral property descriptor.
 */
export function clientProperty(
  value: ClientRuntimePropertyDescriptor,
): RuntimePropertyDescriptor<RuntimeBackendObjectHandle> {
  const { value: propertyValue, get, set, symbol, ...descriptor } = value
  return {
    ...descriptor,
    ...(propertyValue === undefined ? {} : { value: clientRemoteObject(propertyValue) }),
    ...(get === undefined ? {} : { get: clientRemoteObject(get) }),
    ...(set === undefined ? {} : { set: clientRemoteObject(set) }),
    ...(symbol === undefined ? {} : { symbol: clientRemoteObject(symbol) }),
  }
}

/**
 * Convert one Client internal property descriptor.
 * @param value - Client wire internal property.
 * @returns A realm-neutral internal property.
 */
export function clientInternalProperty(
  value: RuntimeInternalPropertyDescriptor<ClientRemoteObjectHandle>,
): RuntimeInternalPropertyDescriptor<RuntimeBackendObjectHandle> {
  return {
    name: value.name,
    ...(value.value === undefined ? {} : { value: clientRemoteObject(value.value) }),
  }
}

/**
 * Convert Client exception details and their optional object.
 * @param value - Client wire exception details.
 * @param mapScriptKey - Realm-wide script identity mapper.
 * @returns Realm-neutral exception details.
 */
export function clientException(
  value: ClientRuntimeExceptionDetails,
  mapScriptKey: ClientScriptKeyMapper,
): RuntimeExceptionDetails<RuntimeBackendObjectHandle> {
  const { exception, ...details } = value
  return {
    ...details,
    ...(value.stackTrace === undefined ? {} : { stackTrace: clientStackTrace(value.stackTrace, mapScriptKey) }),
    ...(exception === undefined ? {} : { exception: clientRemoteObject(exception) }),
  }
}

/**
 * Convert a Client Console event recursively.
 * @param value - Client wire Console event.
 * @param mapScriptKey - Realm-wide script identity mapper.
 * @returns A realm-neutral Console event.
 */
export function clientConsoleEvent(
  value: RuntimeConsoleBackendEvent<ClientRemoteObjectHandle>,
  mapScriptKey: ClientScriptKeyMapper,
): RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle> {
  if (value.type === 'console-api') {
    return {
      type: value.type,
      event: {
        ...value.event,
        arguments: value.event.arguments.map(clientRemoteObject),
        ...(value.event.stackTrace === undefined
          ? {}
          : { stackTrace: clientStackTrace(value.event.stackTrace, mapScriptKey) }),
      },
    }
  }
  return {
    type: value.type,
    event: { ...value.event, details: clientException(value.event.details, mapScriptKey) },
  }
}

/**
 * Convert a Client RemoteObject into the backend-neutral handle slot.
 * @param value - Client wire RemoteObject.
 * @returns A realm-neutral Runtime value.
 */
export function clientRemoteObject(
  value: ClientRuntimeRemoteObject,
): RuntimeRemoteObject<RuntimeBackendObjectHandle> {
  return {
    descriptor: value.descriptor,
    ...(value.object === undefined
      ? {}
      : { object: { handle: backendHandle(value.object.handle) } }),
    ...(value.semanticReference === undefined ? {} : { semanticReference: value.semanticReference }),
  }
}

/**
 * Rebrand a common backend handle for the Client transport that owns it.
 * @param value - Backend handle from a routed Runtime request.
 * @returns The same opaque text under its Client wire role.
 */
export function clientHandle(value: string): ClientRemoteObjectHandle {
  return inspectorId<'ClientRemoteObjectHandle'>(value, 'Client object handle')
}

function backendHandle(value: string): RuntimeBackendObjectHandle {
  return inspectorId<'RuntimeBackendObjectHandle'>(value, 'Runtime backend object handle')
}

function clientStackTrace(value: RuntimeStackTrace, mapScriptKey: ClientScriptKeyMapper): RuntimeStackTrace {
  return {
    ...value,
    callFrames: value.callFrames.map(frame => ({
      ...frame,
      ...(frame.scriptKey === undefined ? {} : { scriptKey: mapScriptKey(frame.scriptKey) }),
    })),
    ...(value.parent === undefined ? {} : { parent: clientStackTrace(value.parent, mapScriptKey) }),
  }
}
