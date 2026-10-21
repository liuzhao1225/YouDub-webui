/** Versioned envelopes for Worker-to-Client Runtime operations. */

import type {
  ClientRuntimeRequestId,
  ClientRuntimeSessionId,
  InspectorSourceGeneration,
  InspectorSourceId,
} from '../../ids.ts'
import { isPlainObject } from '../../../json.ts'
import { exactKeys, exactObject, wireId } from '../../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import { parseClientRuntimeCommand } from './command-codec.ts'
import { parseClientRuntimeResult } from './value-codec.ts'
import type { ClientRuntimeCommand, ClientRuntimeError, ClientRuntimeResult } from './commands.ts'

/** Source capability that permits synthetic Runtime execution contexts. */
export interface ClientRuntimeCapability {
  readonly type: 'client-runtime'
  readonly origin: string
}

/** Worker request for one operation in a specific source generation and DevTools session. */
export interface ClientRuntimeRequestFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/request'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
  readonly command: ClientRuntimeCommand
}

/** Worker cancellation of one outstanding Client Runtime request. */
export interface ClientRuntimeCancelFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/cancel'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
}

/** Worker acknowledgement that commits one successful Client Runtime response. */
export interface ClientRuntimeResponseAcknowledgedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/response-acknowledged'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
}

/** Client response to one typed Runtime request. */
export interface ClientRuntimeResponseFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/response'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
  readonly requestId: ClientRuntimeRequestId
  readonly outcome:
    | { readonly ok: true; readonly result: ClientRuntimeResult }
    | { readonly ok: false; readonly error: ClientRuntimeError }
}

/** One-way cleanup when a DevTools connection or its Runtime domain closes. */
export interface ClientRuntimeSessionClosedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'client-runtime/session-closed'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sessionId: ClientRuntimeSessionId
}

/**
 * Parse and rebuild a Client Runtime capability.
 * @param value - Untrusted capability declaration.
 * @returns The validated capability.
 */
export function parseClientRuntimeCapability(value: unknown): ClientRuntimeCapability {
  const record = exactObject(value, ['type', 'origin'], 'Client Runtime capability')
  if (record.type !== 'client-runtime' || typeof record.origin !== 'string' || record.origin.length > 2_048) {
    throw new Error('inspector protocol: invalid Client Runtime capability')
  }
  return { type: 'client-runtime', origin: record.origin }
}

/**
 * Parse and rebuild one Worker-to-Client Runtime request.
 * @param value - Untrusted request frame.
 * @returns The validated request frame.
 */
export function parseClientRuntimeRequestFrame(value: Record<string, unknown>): ClientRuntimeRequestFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'command'], 'Client Runtime request')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/request') {
    throw new Error('inspector protocol: invalid Client Runtime request envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/request',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
    command: parseClientRuntimeCommand(value.command),
  }
}

/**
 * Parse and rebuild one Worker-to-Client Runtime cancellation.
 * @param value - Untrusted cancellation frame.
 * @returns The validated cancellation frame.
 */
export function parseClientRuntimeCancelFrame(value: Record<string, unknown>): ClientRuntimeCancelFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId'], 'Client Runtime cancellation')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/cancel') {
    throw new Error('inspector protocol: invalid Client Runtime cancellation envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/cancel',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
  }
}

/**
 * Parse and rebuild one Worker acknowledgement for a Client Runtime response.
 * @param value - Untrusted acknowledgement frame.
 * @returns The validated acknowledgement frame.
 */
/* jscpd:ignore-start */
// Deliberately mirrors parseClientRuntimeCancelFrame: each wire parser spells
// out its own envelope literally instead of sharing a tag-parameterized helper.
export function parseClientRuntimeResponseAcknowledgedFrame(
  value: Record<string, unknown>,
): ClientRuntimeResponseAcknowledgedFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId'], 'Client Runtime response acknowledgement')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/response-acknowledged') {
    throw new Error('inspector protocol: invalid Client Runtime response acknowledgement envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/response-acknowledged',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
  }
}
/* jscpd:ignore-end */

/**
 * Parse and rebuild one Client-to-Worker Runtime response.
 * @param value - Untrusted response frame.
 * @returns The validated response frame.
 */
export function parseClientRuntimeResponseFrame(value: Record<string, unknown>): ClientRuntimeResponseFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId', 'requestId', 'outcome'], 'Client Runtime response')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/response') {
    throw new Error('inspector protocol: invalid Client Runtime response envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/response',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
    requestId: wireId<'ClientRuntimeRequestId'>(value.requestId, 'requestId'),
    outcome: parseOutcome(value.outcome),
  }
}

/**
 * Parse and rebuild one Runtime-session cleanup notification.
 * @param value - Untrusted cleanup frame.
 * @returns The validated cleanup frame.
 */
export function parseClientRuntimeSessionClosedFrame(value: Record<string, unknown>): ClientRuntimeSessionClosedFrame {
  exactKeys(value, ['v', 't', 'sourceId', 'generation', 'sessionId'], 'Client Runtime session close')
  if (value.v !== INSPECTOR_PROTOCOL_VERSION || value.t !== 'client-runtime/session-closed') {
    throw new Error('inspector protocol: invalid Client Runtime session close envelope')
  }
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'client-runtime/session-closed',
    sourceId: wireId<'InspectorSourceId'>(value.sourceId, 'sourceId'),
    generation: wireId<'InspectorSourceGeneration'>(value.generation, 'generation'),
    sessionId: wireId<'ClientRuntimeSessionId'>(value.sessionId, 'sessionId'),
  }
}

function parseOutcome(value: unknown): ClientRuntimeResponseFrame['outcome'] {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new Error('inspector protocol: invalid Client Runtime outcome')
  }
  if (value.ok) {
    exactKeys(value, ['ok', 'result'], 'successful Client Runtime outcome')
    return { ok: true, result: parseClientRuntimeResult(value.result) }
  }
  exactKeys(value, ['ok', 'error'], 'failed Client Runtime outcome')
  const error = exactObject(value.error, ['code', 'message'], 'Client Runtime error')
  if (!ERROR_CODES.has(error.code as ClientRuntimeError['code']) || typeof error.message !== 'string') {
    throw new Error('inspector protocol: invalid Client Runtime error')
  }
  return { ok: false, error: { code: error.code as ClientRuntimeError['code'], message: error.message } }
}

const ERROR_CODES = new Set<ClientRuntimeError['code']>([
  'invalid-request', 'object-not-found', 'unsupported', 'timeout', 'result-too-large', 'internal-error',
])
