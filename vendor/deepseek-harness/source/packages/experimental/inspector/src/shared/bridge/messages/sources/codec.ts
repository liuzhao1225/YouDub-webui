/** Exact decoders for Client source catalog operations and values. */

import { isPlainObject } from '../../../json.ts'
import type { RuntimeScript } from '../../../cdp/index.ts'
import { exactKeys, exactObject, optionalBoolean, optionalString, wireId } from '../../../validation.ts'
import type {
  ClientScriptDescriptor,
  ClientSourceCommand,
  ClientSourceContentKind,
  ClientSourceResult,
} from './commands.ts'

/**
 * Parse one Worker-to-Client source command.
 * @param value - Untrusted decoded command.
 * @returns The validated command.
 */
export function parseClientSourceCommand(value: unknown): ClientSourceCommand {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client source command must have an op')
  }
  if (value.op === 'list-scripts') {
    exactKeys(value, ['op'], 'Client source list command')
    return { op: 'list-scripts' }
  }
  if (value.op !== 'get-content-chunk') {
    throw new Error(`inspector protocol: unknown Client source command ${JSON.stringify(value.op)}`)
  }
  exactKeys(value, ['op', 'scriptKey', 'content', 'offset', 'maxBytes'], 'Client source chunk command')
  return {
    op: 'get-content-chunk',
    scriptKey: wireId<'RuntimeScriptKey'>(value.scriptKey, 'scriptKey'),
    content: contentKind(value.content),
    offset: natural(value.offset, 'offset', true),
    maxBytes: natural(value.maxBytes, 'maxBytes', false),
  }
}

/**
 * Parse one successful Client source result.
 * @param value - Untrusted decoded result.
 * @returns The validated result.
 */
export function parseClientSourceResult(value: unknown): ClientSourceResult {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: Client source result must have an op')
  }
  if (value.op === 'list-scripts') {
    exactKeys(value, ['op', 'scripts'], 'Client source list result')
    if (!Array.isArray(value.scripts)) throw new Error('inspector protocol: Client source scripts must be an array')
    return { op: 'list-scripts', scripts: value.scripts.map(parseScript) }
  }
  if (value.op !== 'get-content-chunk') {
    throw new Error(`inspector protocol: unknown Client source result ${JSON.stringify(value.op)}`)
  }
  if (value.available === false) {
    exactKeys(value, ['op', 'scriptKey', 'content', 'available'], 'unavailable Client source chunk')
    return {
      op: 'get-content-chunk',
      scriptKey: wireId<'RuntimeScriptKey'>(value.scriptKey, 'scriptKey'),
      content: contentKind(value.content),
      available: false,
    }
  }
  exactKeys(
    value,
    ['op', 'scriptKey', 'content', 'available', 'offset', 'nextOffset', 'data', 'eof'],
    'Client source chunk result',
  )
  if (value.available !== true || typeof value.data !== 'string' || typeof value.eof !== 'boolean') {
    throw new Error('inspector protocol: invalid Client source chunk result')
  }
  const offset = natural(value.offset, 'offset', true)
  const nextOffset = natural(value.nextOffset, 'nextOffset', true)
  if (nextOffset < offset || !BASE64.test(value.data)) {
    throw new Error('inspector protocol: invalid Client source chunk data')
  }
  return {
    op: 'get-content-chunk',
    scriptKey: wireId<'RuntimeScriptKey'>(value.scriptKey, 'scriptKey'),
    content: contentKind(value.content),
    available: true,
    offset,
    nextOffset,
    data: value.data,
    eof: value.eof,
  }
}

function parseScript(value: unknown): ClientScriptDescriptor {
  const record = exactObject(value, [
    'scriptKey', 'url', 'hash', 'buildId', 'sourceMapUrl', 'startLine', 'startColumn', 'endLine', 'endColumn',
    'isModule', 'length',
  ], 'Client script descriptor')
  if (typeof record.url !== 'string' || record.url.length > 8_192 || typeof record.hash !== 'string') {
    throw new Error('inspector protocol: invalid Client script identity')
  }
  return {
    scriptKey: wireId<'RuntimeScriptKey'>(record.scriptKey, 'scriptKey'),
    url: record.url,
    hash: record.hash,
    ...optionalString(record, 'buildId'),
    ...optionalString(record, 'sourceMapUrl'),
    startLine: natural(record.startLine, 'startLine', true),
    startColumn: natural(record.startColumn, 'startColumn', true),
    endLine: natural(record.endLine, 'endLine', true),
    endColumn: natural(record.endColumn, 'endColumn', true),
    ...optionalBoolean(record, 'isModule'),
    ...(record.length === undefined ? {} : { length: natural(record.length, 'length', true) }),
  } satisfies Omit<RuntimeScript, 'executionContextId'>
}

function contentKind(value: unknown): ClientSourceContentKind {
  if (value !== 'source' && value !== 'source-map') {
    throw new Error('inspector protocol: invalid Client source content kind')
  }
  return value
}

function natural(value: unknown, label: string, zero: boolean): number {
  if (!Number.isSafeInteger(value) || (value as number) < (zero ? 0 : 1)) {
    throw new Error(`inspector protocol: ${label} must be ${zero ? 'a non-negative' : 'a positive'} integer`)
  }
  return value as number
}

const BASE64 = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u
