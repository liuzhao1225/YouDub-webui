/** Exact decoders for non-CDP Inspector query frames. */

import { parseCordisRuntimeTree } from '../../../cordis/model.ts'
import { isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, wireId } from '../../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import type { InspectorQuery, InspectorQueryError, InspectorQueryResult } from './commands.ts'
import type {
  InspectorQueryRequestFrame,
  InspectorQueryRequestId,
  InspectorQueryResponseFrame,
} from './frames.ts'
import type { InspectorSourceGeneration, InspectorSourceId } from '../../ids.ts'

/** Correlation fields recoverable before a query body is accepted. */
export interface InspectorQueryFrameIdentity {
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly requestId: InspectorQueryRequestId
}

/**
 * Test whether a decoded carrier value belongs to the query request protocol.
 * @param value - Decoded carrier value.
 * @returns Whether the query request decoder owns the value.
 */
export function isInspectorQueryRequestEnvelope(value: unknown): boolean {
  return isPlainObject(value) && value.t === 'query/request'
}

/**
 * Test whether a decoded carrier value belongs to the query response protocol.
 * @param value - Decoded carrier value.
 * @returns Whether the query response decoder owns the value.
 */
export function isInspectorQueryResponseEnvelope(value: unknown): boolean {
  return isPlainObject(value) && value.t === 'query/response'
}

/**
 * Decode one source-to-Worker query request.
 * @param value - Untrusted decoded carrier value.
 * @returns The detached, validated request frame.
 */
export function parseInspectorQueryRequestFrame(value: unknown): InspectorQueryRequestFrame {
  const record = exactObject(value, ['v', 't', 'sourceId', 'generation', 'requestId', 'query'], 'query request')
  if (record.v !== INSPECTOR_PROTOCOL_VERSION || record.t !== 'query/request') {
    throw new Error('inspector protocol: invalid query request envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'query/request',
    sourceId: wireId<'InspectorSourceId'>(record.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(record.generation, 'generation'),
    requestId: wireId<'InspectorQueryRequestId'>(record.requestId, 'requestId'),
    query: parseQuery(record.query),
  }
}

/**
 * Decode correlation fields used to reject a malformed request without timing out its caller.
 * @param value - Candidate query request frame.
 * @returns Validated source and request identities.
 */
export function parseInspectorQueryFrameIdentity(value: unknown): InspectorQueryFrameIdentity {
  if (!isPlainObject(value) || value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'query/request') {
    throw new Error('inspector protocol: invalid query request envelope')
  }
  return {
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    requestId: wireId<'InspectorQueryRequestId'>(value.requestId, 'requestId'),
  }
}

/**
 * Decode one Worker-to-source query response.
 * @param value - Untrusted decoded carrier value.
 * @returns The detached, validated response frame.
 */
export function parseInspectorQueryResponseFrame(value: unknown): InspectorQueryResponseFrame {
  const record = exactObject(value, ['v', 't', 'sourceId', 'generation', 'requestId', 'outcome'], 'query response')
  if (record.v !== INSPECTOR_PROTOCOL_VERSION || record.t !== 'query/response') {
    throw new Error('inspector protocol: invalid query response envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'query/response',
    sourceId: wireId<'InspectorSourceId'>(record.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(record.generation, 'generation'),
    requestId: wireId<'InspectorQueryRequestId'>(record.requestId, 'requestId'),
    outcome: parseOutcome(record.outcome),
  }
}

function parseQuery(value: unknown): InspectorQuery {
  const record = exactObject(value, ['op'], 'Inspector query')
  if (record.op !== 'cordis-tree/get') {
    throw new Error(`inspector protocol: unknown query operation ${JSON.stringify(record.op)}`)
  }
  return { op: 'cordis-tree/get' }
}

function parseResult(value: unknown): InspectorQueryResult {
  if (!isPlainObject(value) || typeof value.op !== 'string') {
    throw new Error('inspector protocol: query result must have an op')
  }
  switch (value.op) {
    case 'cordis-tree/get':
      exactKeys(value, ['op', 'tree'], 'Cordis tree query result')
      return { op: 'cordis-tree/get', tree: parseCordisRuntimeTree(value.tree) }
    default:
      throw new Error(`inspector protocol: unknown query result ${JSON.stringify(value.op)}`)
  }
}

function parseOutcome(value: unknown): InspectorQueryResponseFrame['outcome'] {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('inspector protocol: invalid query outcome')
  }
  if (value.ok) {
    exactKeys(value, ['ok', 'result'], 'successful query outcome')
    return { ok: true, result: parseResult(value.result) }
  }
  exactKeys(value, ['ok', 'error'], 'failed query outcome')
  const error = exactObject(value.error, ['code', 'message'], 'query error')
  if (!QUERY_ERROR_CODES.has(error.code as InspectorQueryError['code']) || typeof error.message !== 'string') {
    throw new Error('inspector protocol: invalid query error')
  }
  return {
    ok: false,
    error: { code: error.code as InspectorQueryError['code'], message: error.message },
  }
}

const QUERY_ERROR_CODES = new Set<InspectorQueryError['code']>([
  'invalid-request', 'stale-source', 'result-too-large', 'internal-error',
])
