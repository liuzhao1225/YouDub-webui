/** Exact wire decoder for Client Runtime results and RemoteObject data. */

import { isJsonValue, isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, optionalBoolean, optionalString, wireId } from '../../../validation.ts'
import { parseInspectorObjectReference } from '../../../cordis/object-reference.ts'
import type {
  RuntimeCallFrame,
  RuntimeObjectPreview,
  RuntimePropertyPreview,
  RuntimeRemoteObjectDescriptor,
  RuntimeRemoteObjectSubtype,
  RuntimeRemoteObjectType,
  RuntimeStackTrace,
} from '../../../cdp/index.ts'
import type {
  ClientRuntimeCompletion,
  ClientRuntimeExceptionDetails,
  ClientRuntimeInternalPropertyDescriptor,
  ClientRuntimePropertyDescriptor,
  ClientRuntimeRemoteObject,
  ClientRuntimeResult,
} from './commands.ts'

/**
 * Parse and rebuild one successful Client Runtime result.
 * @param value - Untrusted result value.
 * @returns The validated result union member.
 */
export function parseClientRuntimeResult(value: unknown): ClientRuntimeResult {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client Runtime result must have an op')
  }
  switch (value.op) {
    case 'evaluate':
    case 'call-function':
    case 'await-promise':
      exactKeys(value, ['op', 'completion'], `${value.op} result`)
      return { op: value.op, completion: parseCompletion(value.completion) }
    case 'get-properties': {
      exactKeys(value, ['op', 'properties', 'internalProperties', 'exceptionDetails'], 'get-properties result')
      if (!Array.isArray(value.properties)) throw new Error('inspector protocol: properties must be an array')
      const internal = value.internalProperties
      if (internal !== undefined && !Array.isArray(internal)) {
        throw new Error('inspector protocol: internalProperties must be an array')
      }
      return {
        op: 'get-properties',
        properties: value.properties.map(parsePropertyDescriptor),
        ...(internal === undefined ? {} : { internalProperties: internal.map(parseInternalPropertyDescriptor) }),
        ...(value.exceptionDetails === undefined
          ? {}
          : { exceptionDetails: parseClientRuntimeExceptionDetails(value.exceptionDetails) }),
      }
    }
    case 'release-object':
    case 'release-object-group':
      exactKeys(value, ['op'], `${value.op} result`)
      return { op: value.op }
    case 'global-lexical-scope-names':
      exactKeys(value, ['op', 'names'], 'global-lexical-scope-names result')
      if (!Array.isArray(value.names) || !value.names.every(name => typeof name === 'string')) {
        throw new Error('inspector protocol: lexical scope names must be strings')
      }
      return { op: 'global-lexical-scope-names', names: value.names }
    default:
      throw new Error(`inspector protocol: unknown Client Runtime result ${JSON.stringify(value.op)}`)
  }
}

function parseCompletion(value: unknown): ClientRuntimeCompletion {
  const record = exactObject(value, ['result', 'exceptionDetails'], 'Client Runtime completion')
  return {
    result: parseClientRuntimeRemoteObject(record.result),
    ...(record.exceptionDetails === undefined
      ? {}
      : { exceptionDetails: parseClientRuntimeExceptionDetails(record.exceptionDetails) }),
  }
}

/**
 * Decode one Client Runtime object carrying an optional session-local handle.
 * @param value - Untrusted wire value.
 * @returns The validated realm-neutral object value.
 */
export function parseClientRuntimeRemoteObject(value: unknown): ClientRuntimeRemoteObject {
  const record = exactObject(value, ['descriptor', 'object', 'semanticReference'], 'Client Runtime object')
  const descriptor = parseRemoteObjectDescriptor(record.descriptor)
  const object = record.object === undefined
    ? undefined
    : exactObject(record.object, ['handle'], 'Client Runtime object reference')
  const remote: ClientRuntimeRemoteObject = {
    descriptor,
    ...(object === undefined
      ? {}
      : { object: { handle: wireId<'ClientRemoteObjectHandle'>(object.handle, 'handle') } }),
    ...(record.semanticReference === undefined
      ? {}
      : { semanticReference: parseInspectorObjectReference(record.semanticReference) }),
  }
  validateRemoteObject(remote)
  return remote
}

function parseRemoteObjectDescriptor(value: unknown): RuntimeRemoteObjectDescriptor {
  const record = exactObject(value, [
    'type', 'subtype', 'className', 'value', 'unserializableValue', 'description', 'preview',
  ], 'Runtime object descriptor')
  if (!REMOTE_TYPES.has(record.type as RuntimeRemoteObjectType)) {
    throw new Error('inspector protocol: invalid Client RemoteObject type')
  }
  if (record.subtype !== undefined && !REMOTE_SUBTYPES.has(record.subtype as RuntimeRemoteObjectSubtype)) {
    throw new Error('inspector protocol: invalid Client RemoteObject subtype')
  }
  if (record.value !== undefined && !isJsonValue(record.value)) {
    throw new Error('inspector protocol: Client RemoteObject value must be JSON')
  }
  return {
    type: record.type as RuntimeRemoteObjectType,
    ...(record.subtype === undefined ? {} : { subtype: record.subtype as RuntimeRemoteObjectSubtype }),
    ...optionalString(record, 'className'),
    ...(record.value === undefined ? {} : { value: record.value }),
    ...optionalString(record, 'unserializableValue'),
    ...optionalString(record, 'description'),
    ...(record.preview === undefined ? {} : { preview: parseObjectPreview(record.preview) }),
  }
}

function parseObjectPreview(value: unknown): RuntimeObjectPreview {
  const record = exactObject(value, ['type', 'subtype', 'description', 'overflow', 'properties'], 'object preview')
  if (!REMOTE_TYPES.has(record.type as RuntimeRemoteObjectType)
    || (record.subtype !== undefined && !REMOTE_SUBTYPES.has(record.subtype as RuntimeRemoteObjectSubtype))
    || typeof record.overflow !== 'boolean'
    || !Array.isArray(record.properties)) {
    throw new Error('inspector protocol: invalid object preview')
  }
  return {
    type: record.type as RuntimeRemoteObjectType,
    ...(record.subtype === undefined ? {} : { subtype: record.subtype as RuntimeRemoteObjectSubtype }),
    ...optionalString(record, 'description'),
    overflow: record.overflow,
    properties: record.properties.map(parsePropertyPreview),
  }
}

function parsePropertyPreview(value: unknown): RuntimePropertyPreview {
  const record = exactObject(value, ['name', 'type', 'value', 'valuePreview', 'subtype'], 'property preview')
  if (typeof record.name !== 'string'
    || (record.type !== 'accessor' && !REMOTE_TYPES.has(record.type as RuntimeRemoteObjectType))
    || (record.subtype !== undefined && !REMOTE_SUBTYPES.has(record.subtype as RuntimeRemoteObjectSubtype))) {
    throw new Error('inspector protocol: invalid property preview')
  }
  return {
    name: record.name,
    type: record.type as RuntimePropertyPreview['type'],
    ...optionalString(record, 'value'),
    ...(record.valuePreview === undefined ? {} : { valuePreview: parseObjectPreview(record.valuePreview) }),
    ...(record.subtype === undefined ? {} : { subtype: record.subtype as RuntimeRemoteObjectSubtype }),
  }
}

function parsePropertyDescriptor(value: unknown): ClientRuntimePropertyDescriptor {
  const record = exactObject(value, [
    'name', 'value', 'writable', 'get', 'set', 'configurable', 'enumerable', 'wasThrown', 'isOwn', 'symbol',
  ], 'property descriptor')
  if (typeof record.name !== 'string' || typeof record.configurable !== 'boolean' || typeof record.enumerable !== 'boolean') {
    throw new Error('inspector protocol: invalid property descriptor')
  }
  const dataDescriptor = record.value !== undefined || record.writable !== undefined
  const accessorDescriptor = record.get !== undefined || record.set !== undefined
  if (dataDescriptor && accessorDescriptor) {
    throw new Error('inspector protocol: property descriptor mixes data and accessor fields')
  }
  return {
    name: record.name,
    ...(record.value === undefined ? {} : { value: parseClientRuntimeRemoteObject(record.value) }),
    ...optionalBoolean(record, 'writable'),
    ...(record.get === undefined ? {} : { get: parseClientRuntimeRemoteObject(record.get) }),
    ...(record.set === undefined ? {} : { set: parseClientRuntimeRemoteObject(record.set) }),
    configurable: record.configurable,
    enumerable: record.enumerable,
    ...optionalBoolean(record, 'wasThrown'),
    ...optionalBoolean(record, 'isOwn'),
    ...(record.symbol === undefined ? {} : { symbol: parseClientRuntimeRemoteObject(record.symbol) }),
  }
}

function parseInternalPropertyDescriptor(value: unknown): ClientRuntimeInternalPropertyDescriptor {
  const record = exactObject(value, ['name', 'value'], 'internal property descriptor')
  if (typeof record.name !== 'string') throw new Error('inspector protocol: invalid internal property descriptor')
  return {
    name: record.name,
    ...(record.value === undefined ? {} : { value: parseClientRuntimeRemoteObject(record.value) }),
  }
}

/**
 * Decode Client exception details used by command results and events.
 * @param value - Untrusted wire value.
 * @returns Validated exception details.
 */
export function parseClientRuntimeExceptionDetails(value: unknown): ClientRuntimeExceptionDetails {
  const record = exactObject(value, [
    'text', 'lineNumber', 'columnNumber', 'url', 'stackTrace', 'exception',
  ], 'exception details')
  if (typeof record.text !== 'string'
    || !Number.isSafeInteger(record.lineNumber)
    || (record.lineNumber as number) < 0
    || !Number.isSafeInteger(record.columnNumber)
    || (record.columnNumber as number) < 0) {
    throw new Error('inspector protocol: invalid exception details')
  }
  return {
    text: record.text,
    lineNumber: record.lineNumber as number,
    columnNumber: record.columnNumber as number,
    ...optionalString(record, 'url'),
    ...(record.stackTrace === undefined ? {} : { stackTrace: parseClientRuntimeStackTrace(record.stackTrace) }),
    ...(record.exception === undefined ? {} : { exception: parseClientRuntimeRemoteObject(record.exception) }),
  }
}

/**
 * Decode a stack trace carried by a Client Runtime or Console frame.
 * @param value - Untrusted stack-trace value.
 * @returns The validated realm-neutral stack trace.
 */
export function parseClientRuntimeStackTrace(value: unknown): RuntimeStackTrace {
  const record = exactObject(value, ['description', 'callFrames', 'parent'], 'stack trace')
  if (!Array.isArray(record.callFrames)) throw new Error('inspector protocol: stack callFrames must be an array')
  return {
    ...optionalString(record, 'description'),
    callFrames: record.callFrames.map(parseCallFrame),
    ...(record.parent === undefined ? {} : { parent: parseClientRuntimeStackTrace(record.parent) }),
  }
}

function parseCallFrame(value: unknown): RuntimeCallFrame {
  const record = exactObject(value, ['functionName', 'scriptKey', 'url', 'lineNumber', 'columnNumber'], 'stack call frame')
  if (typeof record.functionName !== 'string'
    || typeof record.url !== 'string'
    || !Number.isSafeInteger(record.lineNumber)
    || !Number.isSafeInteger(record.columnNumber)) {
    throw new Error('inspector protocol: invalid stack call frame')
  }
  return {
    functionName: record.functionName,
    ...(record.scriptKey === undefined ? {} : { scriptKey: wireId<'RuntimeScriptKey'>(record.scriptKey, 'scriptKey') }),
    url: record.url,
    lineNumber: record.lineNumber as number,
    columnNumber: record.columnNumber as number,
  }
}

const REMOTE_TYPES = new Set<RuntimeRemoteObjectType>([
  'object', 'function', 'undefined', 'string', 'number', 'boolean', 'symbol', 'bigint',
])

const REMOTE_SUBTYPES = new Set<RuntimeRemoteObjectSubtype>([
  'array', 'null', 'node', 'regexp', 'date', 'map', 'set', 'weakmap', 'weakset', 'iterator', 'generator',
  'error', 'proxy', 'promise', 'typedarray', 'arraybuffer', 'dataview', 'webassemblymemory', 'wasmvalue',
])

function validateRemoteObject(value: ClientRuntimeRemoteObject): void {
  if (value.semanticReference !== undefined && value.object === undefined) {
    throw new Error('inspector protocol: semanticReference requires a retained Client object')
  }
  const descriptor = value.descriptor
  if (descriptor.subtype !== undefined && descriptor.type !== 'object') {
    throw new Error('inspector protocol: only object RemoteObjects may have a subtype')
  }
  if (descriptor.preview !== undefined && descriptor.type !== 'object') {
    throw new Error('inspector protocol: only object RemoteObjects may have a preview')
  }
  const hasValue = descriptor.value !== undefined
  const hasUnserializableValue = descriptor.unserializableValue !== undefined
  const hasObject = value.object !== undefined
  switch (descriptor.type) {
    case 'undefined':
      requireRepresentations(descriptor.type, hasValue, hasUnserializableValue, hasObject, false, false, false)
      return
    case 'string':
      requireRepresentations(descriptor.type, typeof descriptor.value === 'string', hasUnserializableValue, hasObject, true, false, false)
      return
    case 'boolean':
      requireRepresentations(descriptor.type, typeof descriptor.value === 'boolean', hasUnserializableValue, hasObject, true, false, false)
      return
    case 'number': {
      const finite = typeof descriptor.value === 'number'
        && Number.isFinite(descriptor.value)
        && !Object.is(descriptor.value, -0)
      const special = descriptor.unserializableValue === 'NaN'
        || descriptor.unserializableValue === 'Infinity'
        || descriptor.unserializableValue === '-Infinity'
        || descriptor.unserializableValue === '-0'
      if (hasObject || finite === special) throw new Error('inspector protocol: invalid number RemoteObject representation')
      return
    }
    case 'bigint':
      if (hasValue || hasObject || !/^-?(?:0|[1-9]\d*)n$/u.test(descriptor.unserializableValue ?? '')) {
        throw new Error('inspector protocol: invalid bigint RemoteObject representation')
      }
      return
    case 'symbol':
    case 'function':
      requireRepresentations(descriptor.type, hasValue, hasUnserializableValue, hasObject, false, false, true)
      return
    case 'object':
      if (descriptor.subtype === 'null') {
        if (descriptor.value !== null || hasObject || hasUnserializableValue) {
          throw new Error('inspector protocol: invalid null RemoteObject representation')
        }
        return
      }
      if (hasUnserializableValue || hasValue === hasObject) {
        throw new Error('inspector protocol: object RemoteObject needs exactly one value or backend object')
      }
  }
}

function requireRepresentations(
  type: RuntimeRemoteObjectType,
  hasValue: boolean,
  hasUnserializableValue: boolean,
  hasObject: boolean,
  expectedValue: boolean,
  expectedUnserializableValue: boolean,
  expectedObject: boolean,
): void {
  if (hasValue !== expectedValue
    || hasUnserializableValue !== expectedUnserializableValue
    || hasObject !== expectedObject) {
    throw new Error(`inspector protocol: invalid ${type} RemoteObject representation`)
  }
}
