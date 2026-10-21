/** Versioned source lifecycle, observation, and extension frames shared by both carriers. */

import { inspectorId, type InspectorSourceGeneration, type InspectorSourceId } from '../ids.ts'
import { isJsonValue, isPlainObject, type InspectorJsonValue } from '../../json.ts'
import { exactKeys } from '../../validation.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../version.ts'
import {
  parseClientConsoleCapability,
  parseClientConsoleControlFrame,
  parseClientConsoleEventFrame,
  parseClientRuntimeCapability,
  parseClientRuntimeCancelFrame,
  parseClientRuntimeRequestFrame,
  parseClientRuntimeResponseAcknowledgedFrame,
  parseClientRuntimeResponseFrame,
  parseClientRuntimeSessionClosedFrame,
  type ClientConsoleCapability,
  type ClientConsoleDisableFrame,
  type ClientConsoleEnableFrame,
  type ClientConsoleEventFrame,
  type ClientRuntimeCapability,
  type ClientRuntimeCancelFrame,
  type ClientRuntimeRequestFrame,
  type ClientRuntimeResponseAcknowledgedFrame,
  type ClientRuntimeResponseFrame,
  type ClientRuntimeSessionClosedFrame,
} from './runtime/index.ts'
import {
  parseClientSourceRequestFrame,
  parseClientSourceResponseFrame,
  parseClientSourceSessionClosedFrame,
  parseClientSourcesCapability,
  type ClientSourceRequestFrame,
  type ClientSourceResponseFrame,
  type ClientSourceSessionClosedFrame,
  type ClientSourcesCapability,
} from './sources/index.ts'

export { INSPECTOR_PROTOCOL_VERSION } from '../version.ts'

/** Realm producing observations. */
export type InspectorSourceKind = 'host' | 'client'

/** Optional protocols implemented by one source generation. */
export type InspectorSourceCapability = ClientRuntimeCapability | ClientConsoleCapability | ClientSourcesCapability

/** One logical source and connection generation. */
export interface InspectorSourceDescriptor {
  /** Producer identity retained across transport reconnects. */
  readonly sourceId: InspectorSourceId
  /** One transport admission, replaced on every reconnect. */
  readonly generation: InspectorSourceGeneration
  readonly kind: InspectorSourceKind
  readonly label: string
  readonly timeOriginMs: number
  readonly capabilities: readonly InspectorSourceCapability[]
}

/** One domain-owned observation before its sequence is assigned. */
export interface InspectorRecordInput {
  readonly monotonicMs: number
  readonly topic: string
  readonly payload: InspectorJsonValue
}

/** Initial source handshake. */
export interface SourceOpenFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/open'
  readonly source: InspectorSourceDescriptor
  readonly topics: readonly string[]
}

/** Replace one source's current state after opening or resynchronization. */
export interface SourceReplaceFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/replace'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly nextSequence: number
  readonly records: readonly InspectorRecordInput[]
}

/** Append one contiguous observation batch. */
export interface SourceAppendFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/append'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly firstSequence: number
  readonly droppedBefore: number
  readonly records: readonly InspectorRecordInput[]
}

/** Clean source closure. */
export interface SourceCloseFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/close'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
}

/** Every source-to-Worker frame. */
export type SourceToWorkerFrame =
  | SourceOpenFrame
  | SourceReplaceFrame
  | SourceAppendFrame
  | SourceCloseFrame
  | ClientConsoleEventFrame
  | ClientRuntimeResponseFrame
  | ClientSourceResponseFrame

/** Worker acceptance of one source generation. */
export interface SourceAcceptedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/accepted'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
}

/** Worker acknowledgement that releases one Host MessagePort batch credit. */
export interface SourceAppendAcknowledgedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/append-acknowledged'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly nextSequence: number
}

/** Worker request for a complete source-state replacement. */
export interface SourceResnapshotFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/resnapshot'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly expectedSequence: number
  readonly reason: string
}

/** Rejection of one malformed or incompatible source connection. */
export interface SourceRejectedFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'source/rejected'
  readonly code: 'invalid-frame' | 'version-mismatch' | 'unauthorized'
  readonly message: string
}

/** Every Worker-to-source control frame. */
export type WorkerToSourceFrame =
  | SourceAcceptedFrame
  | SourceAppendAcknowledgedFrame
  | SourceResnapshotFrame
  | SourceRejectedFrame
  | ClientConsoleEnableFrame
  | ClientConsoleDisableFrame
  | ClientRuntimeCancelFrame
  | ClientRuntimeRequestFrame
  | ClientRuntimeResponseAcknowledgedFrame
  | ClientRuntimeSessionClosedFrame
  | ClientSourceRequestFrame
  | ClientSourceSessionClosedFrame

/**
 * Parse and rebuild one Worker control frame received by a source.
 * @param value - Untrusted decoded wire value.
 * @returns The validated Worker-to-source frame.
 */
export function parseWorkerSourceFrame(value: unknown): WorkerToSourceFrame {
  if (!isJsonValue(value)
    || !isPlainObject(value)
    || value.v !== INSPECTOR_PROTOCOL_VERSION
    || typeof value.t !== 'string') {
    throw new Error('inspector protocol: invalid Worker source frame')
  }
  if (value.t === 'source/rejected') {
    exactKeys(value, ['v', 't', 'code', 'message'], 'source/rejected frame')
    if ((value.code !== 'invalid-frame' && value.code !== 'version-mismatch' && value.code !== 'unauthorized')
      || typeof value.message !== 'string') {
      throw new Error('inspector protocol: invalid source/rejected frame')
    }
    return { v: INSPECTOR_PROTOCOL_VERSION, t: 'source/rejected', code: value.code, message: value.message }
  }
  if (value.t === 'client-runtime/request') return parseClientRuntimeRequestFrame(value)
  if (value.t === 'client-runtime/cancel') return parseClientRuntimeCancelFrame(value)
  if (value.t === 'client-runtime/response-acknowledged') {
    return parseClientRuntimeResponseAcknowledgedFrame(value)
  }
  if (value.t === 'client-runtime/session-closed') return parseClientRuntimeSessionClosedFrame(value)
  if (value.t === 'client-sources/request') return parseClientSourceRequestFrame(value)
  if (value.t === 'client-sources/session-closed') return parseClientSourceSessionClosedFrame(value)
  if (value.t === 'client-console/enable' || value.t === 'client-console/disable') {
    return parseClientConsoleControlFrame(value)
  }
  const common = {
    v: INSPECTOR_PROTOCOL_VERSION,
    sourceId: sourceId(value.sourceId),
    generation: generation(value.generation),
  } as const
  if (value.t === 'source/accepted') {
    exactKeys(value, ['v', 't', 'sourceId', 'generation'], 'source/accepted frame')
    return { ...common, t: 'source/accepted' }
  }
  if (value.t === 'source/append-acknowledged') {
    exactKeys(value, ['v', 't', 'sourceId', 'generation', 'nextSequence'], 'source append acknowledgement')
    return {
      ...common,
      t: 'source/append-acknowledged',
      nextSequence: natural(value.nextSequence, 'nextSequence'),
    }
  }
  if (value.t === 'source/resnapshot'
    && typeof value.reason === 'string') {
    exactKeys(value, ['v', 't', 'sourceId', 'generation', 'expectedSequence', 'reason'], 'source/resnapshot frame')
    return {
      ...common,
      t: 'source/resnapshot',
      expectedSequence: natural(value.expectedSequence, 'expectedSequence'),
      reason: value.reason,
    }
  }
  throw new Error(`inspector protocol: unknown Worker source frame ${JSON.stringify(value.t)}`)
}

/**
 * Parse and rebuild one source frame received at a process or network boundary.
 * @param value - Untrusted decoded wire value.
 * @param maxRecords - Maximum records admitted in one frame.
 * @returns The validated source-to-Worker frame.
 */
export function parseSourceFrame(value: unknown, maxRecords: number): SourceToWorkerFrame {
  if (!isJsonValue(value) || !isPlainObject(value)) {
    throw new Error('inspector protocol: source frame must be a lossless JSON object')
  }
  if (value.v !== INSPECTOR_PROTOCOL_VERSION) {
    throw new Error(`inspector protocol: unsupported version ${JSON.stringify(value.v)}`)
  }
  switch (value.t) {
    case 'source/open':
      return parseOpen(value)
    case 'source/replace':
      return parseRecordsFrame(value, maxRecords, true)
    case 'source/append':
      return parseRecordsFrame(value, maxRecords, false)
    case 'source/close':
      exactKeys(value, ['v', 't', 'sourceId', 'generation'], 'source/close frame')
      return {
        v: INSPECTOR_PROTOCOL_VERSION,
        t: 'source/close',
        sourceId: sourceId(value.sourceId),
        generation: generation(value.generation),
      }
    case 'client-runtime/response':
      return parseClientRuntimeResponseFrame(value)
    case 'client-console/event':
      return parseClientConsoleEventFrame(value)
    case 'client-sources/response':
      return parseClientSourceResponseFrame(value)
    default:
      throw new Error(`inspector protocol: unknown source frame ${JSON.stringify(value.t)}`)
  }
}

function parseOpen(value: Record<string, unknown>): SourceOpenFrame {
  exactKeys(value, ['v', 't', 'source', 'topics'], 'source/open frame')
  if (!isPlainObject(value.source) || !Array.isArray(value.topics)) {
    throw new Error('inspector protocol: source/open needs source and topics')
  }
  const source = value.source
  exactKeys(source, ['sourceId', 'generation', 'kind', 'label', 'timeOriginMs', 'capabilities'], 'source descriptor')
  const kind = source.kind
  if (kind !== 'host' && kind !== 'client') throw new Error('inspector protocol: invalid source kind')
  if (typeof source.label !== 'string' || source.label.length === 0 || source.label.length > 256) {
    throw new Error('inspector protocol: source label must contain 1 to 256 characters')
  }
  if (typeof source.timeOriginMs !== 'number' || !Number.isFinite(source.timeOriginMs)) {
    throw new Error('inspector protocol: source timeOriginMs must be finite')
  }
  if (!Array.isArray(source.capabilities)) {
    throw new Error('inspector protocol: source capabilities must be an array')
  }
  const capabilities = source.capabilities.map(parseSourceCapability)
  const capabilityTypes = new Set<string>()
  for (const capability of capabilities) {
    if (capabilityTypes.has(capability.type)) {
      throw new Error(`inspector protocol: source declares ${capability.type} more than once`)
    }
    capabilityTypes.add(capability.type)
  }
  if (kind !== 'client' && capabilities.length > 0) {
    throw new Error('inspector protocol: Host sources cannot declare Client capabilities')
  }
  const topics = value.topics.map((topic) => {
    if (typeof topic !== 'string' || topic.length === 0 || topic.length > 128) {
      throw new Error('inspector protocol: every source topic must contain 1 to 128 characters')
    }
    return topic
  })
  return {
    v: INSPECTOR_PROTOCOL_VERSION,
    t: 'source/open',
    source: {
      sourceId: sourceId(source.sourceId),
      generation: generation(source.generation),
      kind,
      label: source.label,
      timeOriginMs: source.timeOriginMs,
      capabilities,
    },
    topics,
  }
}

function parseSourceCapability(value: unknown): InspectorSourceCapability {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    throw new Error('inspector protocol: source capability must have a type')
  }
  switch (value.type) {
    case 'client-runtime': return parseClientRuntimeCapability(value)
    case 'client-console': return parseClientConsoleCapability(value)
    case 'client-sources': return parseClientSourcesCapability(value)
    default: throw new Error(`inspector protocol: unknown source capability ${JSON.stringify(value.type)}`)
  }
}

function parseRecordsFrame(
  value: Record<string, unknown>,
  maxRecords: number,
  replace: boolean,
): SourceReplaceFrame | SourceAppendFrame {
  exactKeys(
    value,
    replace
      ? ['v', 't', 'sourceId', 'generation', 'nextSequence', 'records']
      : ['v', 't', 'sourceId', 'generation', 'firstSequence', 'droppedBefore', 'records'],
    replace ? 'source/replace frame' : 'source/append frame',
  )
  if (!Array.isArray(value.records) || value.records.length > maxRecords) {
    throw new Error(`inspector protocol: source batch exceeds ${String(maxRecords)} records`)
  }
  const records = value.records.map(parseRecord)
  const common = {
    v: INSPECTOR_PROTOCOL_VERSION,
    sourceId: sourceId(value.sourceId),
    generation: generation(value.generation),
    records,
  } as const
  if (replace) {
    return {
      ...common,
      t: 'source/replace',
      nextSequence: natural(value.nextSequence, 'nextSequence'),
    }
  }
  return {
    ...common,
    t: 'source/append',
    firstSequence: natural(value.firstSequence, 'firstSequence'),
    droppedBefore: natural(value.droppedBefore, 'droppedBefore'),
  }
}

function parseRecord(value: unknown): InspectorRecordInput {
  if (!isPlainObject(value)
    || typeof value.monotonicMs !== 'number'
    || !Number.isFinite(value.monotonicMs)
    || typeof value.topic !== 'string'
    || value.topic.length === 0
    || value.topic.length > 128
    || !isJsonValue(value.payload)) {
    throw new Error('inspector protocol: invalid observation record')
  }
  exactKeys(value, ['monotonicMs', 'topic', 'payload'], 'observation record')
  return { monotonicMs: value.monotonicMs, topic: value.topic, payload: value.payload }
}

function sourceId(value: unknown): InspectorSourceId {
  if (typeof value !== 'string') throw new Error('inspector protocol: sourceId must be a string')
  return inspectorId<'InspectorSourceId'>(value, 'sourceId')
}

function generation(value: unknown): InspectorSourceGeneration {
  if (typeof value !== 'string') throw new Error('inspector protocol: generation must be a string')
  return inspectorId<'InspectorSourceGeneration'>(value, 'generation')
}

function natural(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`inspector protocol: ${label} must be a non-negative safe integer`)
  }
  return value as number
}
