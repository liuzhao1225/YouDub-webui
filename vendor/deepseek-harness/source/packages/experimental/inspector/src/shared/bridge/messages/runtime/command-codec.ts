/** Exact wire decoder for Client Runtime commands. */

import { isJsonValue, isPlainObject } from '../../../json.ts'
import { exactKeys, optionalBoolean, optionalNonNegativeNumber, optionalString, wireId } from '../../../validation.ts'
import type { ClientCallArgument, ClientRuntimeCallFunctionCommand, ClientRuntimeCommand } from './commands.ts'

/**
 * Parse and rebuild one Runtime command before it enters the Client realm.
 * @param value - Untrusted command value.
 * @returns The validated command union member.
 */
export function parseClientRuntimeCommand(value: unknown): ClientRuntimeCommand {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client Runtime command must have an op')
  }
  switch (value.op) {
    case 'evaluate': {
      exactKeys(value, [
        'op', 'expression', 'objectGroup', 'includeCommandLineAPI', 'silent', 'returnByValue',
        'generatePreview', 'userGesture', 'awaitPromise', 'disableBreaks', 'replMode',
        'allowUnsafeEvalBlockedByCSP', 'timeoutMs',
      ], 'evaluate command')
      if (typeof value.expression !== 'string') throw new Error('inspector protocol: evaluate expression must be a string')
      return {
        op: 'evaluate',
        expression: value.expression,
        ...optionalString(value, 'objectGroup'),
        ...optionalBoolean(value, 'includeCommandLineAPI'),
        ...optionalBoolean(value, 'silent'),
        ...optionalBoolean(value, 'returnByValue'),
        ...optionalBoolean(value, 'generatePreview'),
        ...optionalBoolean(value, 'userGesture'),
        ...optionalBoolean(value, 'awaitPromise'),
        ...optionalBoolean(value, 'disableBreaks'),
        ...optionalBoolean(value, 'replMode'),
        ...optionalBoolean(value, 'allowUnsafeEvalBlockedByCSP'),
        ...optionalNonNegativeNumber(value, 'timeoutMs'),
      }
    }
    case 'get-properties':
      exactKeys(value, [
        'op', 'handle', 'ownProperties', 'accessorPropertiesOnly', 'generatePreview', 'nonIndexedPropertiesOnly',
      ], 'get-properties command')
      return {
        op: 'get-properties',
        handle: wireId<'ClientRemoteObjectHandle'>(value.handle, 'handle'),
        ...optionalBoolean(value, 'ownProperties'),
        ...optionalBoolean(value, 'accessorPropertiesOnly'),
        ...optionalBoolean(value, 'generatePreview'),
        ...optionalBoolean(value, 'nonIndexedPropertiesOnly'),
      }
    case 'call-function':
      return parseCallFunction(value)
    case 'await-promise':
      exactKeys(value, ['op', 'promise', 'returnByValue', 'generatePreview'], 'await-promise command')
      return {
        op: 'await-promise',
        promise: wireId<'ClientRemoteObjectHandle'>(value.promise, 'promise'),
        ...optionalBoolean(value, 'returnByValue'),
        ...optionalBoolean(value, 'generatePreview'),
      }
    case 'release-object':
      exactKeys(value, ['op', 'handle'], 'release-object command')
      return {
        op: 'release-object',
        handle: wireId<'ClientRemoteObjectHandle'>(value.handle, 'handle'),
      }
    case 'release-object-group':
      exactKeys(value, ['op', 'objectGroup'], 'release-object-group command')
      if (typeof value.objectGroup !== 'string') throw new Error('inspector protocol: objectGroup must be a string')
      return { op: 'release-object-group', objectGroup: value.objectGroup }
    case 'global-lexical-scope-names':
      exactKeys(value, ['op'], 'global-lexical-scope-names command')
      return { op: 'global-lexical-scope-names' }
    default:
      throw new Error(`inspector protocol: unknown Client Runtime command ${JSON.stringify(value.op)}`)
  }
}

function parseCallFunction(value: Record<string, unknown>): ClientRuntimeCallFunctionCommand {
  exactKeys(value, [
    'op', 'functionDeclaration', 'receiver', 'arguments', 'objectGroup', 'silent', 'returnByValue',
    'generatePreview', 'userGesture', 'awaitPromise',
  ], 'call-function command')
  if (typeof value.functionDeclaration !== 'string') {
    throw new Error('inspector protocol: functionDeclaration must be a string')
  }
  let args: readonly ClientCallArgument[] | undefined
  if (value.arguments !== undefined) {
    if (!Array.isArray(value.arguments)) throw new Error('inspector protocol: call arguments must be an array')
    args = value.arguments.map(parseCallArgument)
  }
  return {
    op: 'call-function',
    functionDeclaration: value.functionDeclaration,
    ...(value.receiver === undefined
      ? {}
      : { receiver: wireId<'ClientRemoteObjectHandle'>(value.receiver, 'receiver') }),
    ...(args === undefined ? {} : { arguments: args }),
    ...optionalString(value, 'objectGroup'),
    ...optionalBoolean(value, 'silent'),
    ...optionalBoolean(value, 'returnByValue'),
    ...optionalBoolean(value, 'generatePreview'),
    ...optionalBoolean(value, 'userGesture'),
    ...optionalBoolean(value, 'awaitPromise'),
  }
}

function parseCallArgument(value: unknown): ClientCallArgument {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    throw new Error('inspector protocol: invalid Client Runtime call argument')
  }
  switch (value.kind) {
    case 'value':
      exactKeys(value, ['kind', 'value'], 'value call argument')
      if (!isJsonValue(value.value)) throw new Error('inspector protocol: call argument value must be JSON')
      return { kind: 'value', value: value.value }
    case 'unserializable':
      exactKeys(value, ['kind', 'value'], 'unserializable call argument')
      if (typeof value.value !== 'string') throw new Error('inspector protocol: unserializable argument must be a string')
      return { kind: 'unserializable', value: value.value }
    case 'object':
      exactKeys(value, ['kind', 'handle'], 'object call argument')
      return {
        kind: 'object',
        handle: wireId<'ClientRemoteObjectHandle'>(value.handle, 'handle'),
      }
    case 'undefined':
      exactKeys(value, ['kind'], 'undefined call argument')
      return { kind: 'undefined' }
    default:
      throw new Error(`inspector protocol: unknown call argument ${JSON.stringify(value.kind)}`)
  }
}
