/** Versioned envelopes for Client source catalog operations. */

import type {
  ClientSourceRequestId,
  ClientSourceSessionId,
  InspectorSourceGeneration,
  InspectorSourceId,
} from '../../ids.ts'
import { isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, wireId } from '../../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import { parseClientSourceCommand, parseClientSourceResult } from './codec.ts'
import type { ClientSourceCommand, ClientSourceError, ClientSourceResult } from './commands.ts'

/** Source capability that permits read-only Client script discovery. */
export interface ClientSourcesCapability {
  readonly type: 'client-sources'
}

/** Worker request for one operation in a Client source catalog. */
export interface ClientSourceRequestFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-sources/request'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientSourceSessionId
  readonly requestId: ClientSourceRequestId
  readonly command: ClientSourceCommand
}

/** Client response to one source catalog operation. */
export interface ClientSourceResponseFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-sources/response'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientSourceSessionId
  readonly requestId: ClientSourceRequestId
  readonly outcome:
    | { readonly ok: true; readonly result: ClientSourceResult }
    | { readonly ok: false; readonly error: ClientSourceError }
}

/** One-way cleanup for in-flight operations owned by a closed DevTools session. */
export interface ClientSourceSessionClosedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-sources/session-closed'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientSourceSessionId
}

/**
 * Parse the marker capability for a Client source catalog.
 * @param value - Untrusted capability declaration.
 * @returns The validated marker capability.
 */
export function parseClientSourcesCapability(value: unknown): ClientSourcesCapability {
  const record = exactObject(value, ['type'], 'Client Sources capability')
  if (record.type !== 'client-sources') throw new Error('inspector protocol: invalid Client Sources capability')
  return { type: 'client-sources' }
}

/**
 * Parse one Worker-to-Client source request.
 * @param value - Untrusted decoded request.
 * @returns The validated request frame.
 */
export function parseClientSourceRequestFrame(value: Record<string, unknown>): ClientSourceRequestFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'command'], 'Client source request')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-sources/request') {
    throw new Error('inspector protocol: invalid Client source request envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-sources/request',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientSourceSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientSourceRequestId'>(value.requestId, 'requestId'),
    command: parseClientSourceCommand(value.command),
  }
}

/**
 * Parse one Client-to-Worker source response.
 * @param value - Untrusted decoded response.
 * @returns The validated response frame.
 */
export function parseClientSourceResponseFrame(value: Record<string, unknown>): ClientSourceResponseFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'outcome'], 'Client source response')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-sources/response') {
    throw new Error('inspector protocol: invalid Client source response envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-sources/response',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientSourceSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientSourceRequestId'>(value.requestId, 'requestId'),
    outcome: parseOutcome(value.outcome),
  }
}

/**
 * Parse one Client source-session cleanup notification.
 * @param value - Untrusted decoded notification.
 * @returns The validated cleanup frame.
 */
export function parseClientSourceSessionClosedFrame(value: Record<string, unknown>): ClientSourceSessionClosedFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId'], 'Client source session close')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-sources/session-closed') {
    throw new Error('inspector protocol: invalid Client source session close envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-sources/session-closed',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientSourceSessionId'>(value.sessionId, 'sessionId'),
  }
}

function parseOutcome(value: unknown): ClientSourceResponseFrame['outcome'] {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('inspector protocol: invalid Client source outcome')
  }
  if (value.ok) {
    exactKeys(value, ['ok', 'result'], 'successful Client source outcome')
    return { ok: true, result: parseClientSourceResult(value.result) }
  }
  exactKeys(value, ['ok', 'error'], 'failed Client source outcome')
  const error = exactObject(value.error, ['code', 'message'], 'Client source error')
  if (!ERROR_CODES.has(error.code as ClientSourceError['code']) || typeof error.message !== 'string') {
    throw new Error('inspector protocol: invalid Client source error')
  }
  return { ok: false, error: { code: error.code as ClientSourceError['code'], message: error.message } }
}

const ERROR_CODES = new Set<ClientSourceError['code']>([
  'invalid-request', 'script-not-found', 'load-failed', 'result-too-large', 'internal-error',
])
