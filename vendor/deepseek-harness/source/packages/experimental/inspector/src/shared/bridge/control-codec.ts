/** Exact decoders for Host, Worker, and injected Client lifecycle values. */

import type {
  InspectorClientBootstrap,
  InspectorHostControl,
  InspectorWorkerConfig,
  InspectorWorkerControl,
} from './messages/control.ts'
import { isPlainObject } from '../json.ts'
import { exactKeys, exactObject } from '../validation.ts'

/**
 * Decode the structured-cloned Worker configuration.
 * @param value - Untrusted workerData config value.
 * @returns The validated Worker configuration.
 */
export function parseInspectorWorkerConfig(value: unknown): InspectorWorkerConfig {
  const record = exactObject(value, [
    'host', 'startPort', 'targetId', 'clientToken', 'clientOrigins', 'maxSourceFrameBytes',
    'maxSourceRecordsPerFrame', 'maxRetainedRequests', 'maxJournalBytes', 'clientRuntimeTimeoutMs', 'maxCordisNodes',
    'maxDisconnectedCordisTrees', 'maxClientSourceBytes',
  ], 'Worker config')
  if (record.host !== '127.0.0.1') throw new Error('inspector protocol: Worker host must be 127.0.0.1')
  if (typeof record.targetId !== 'string' || record.targetId.length === 0) {
    throw new Error('inspector protocol: Worker targetId must be a non-empty string')
  }
  if (typeof record.clientToken !== 'string' || record.clientToken.length === 0) {
    throw new Error('inspector protocol: Worker clientToken must be a non-empty string')
  }
  if (!Array.isArray(record.clientOrigins) || !record.clientOrigins.every(origin => typeof origin === 'string')) {
    throw new Error('inspector protocol: Worker clientOrigins must be strings')
  }
  const startPort = natural(record.startPort, 'startPort', true)
  if (startPort > 65_535) throw new Error('inspector protocol: Worker startPort must not exceed 65535')
  return {
    host: record.host,
    startPort,
    targetId: record.targetId,
    clientToken: record.clientToken,
    clientOrigins: record.clientOrigins,
    maxSourceFrameBytes: natural(record.maxSourceFrameBytes, 'maxSourceFrameBytes'),
    maxSourceRecordsPerFrame: natural(record.maxSourceRecordsPerFrame, 'maxSourceRecordsPerFrame'),
    maxRetainedRequests: natural(record.maxRetainedRequests, 'maxRetainedRequests'),
    maxJournalBytes: natural(record.maxJournalBytes, 'maxJournalBytes'),
    clientRuntimeTimeoutMs: natural(record.clientRuntimeTimeoutMs, 'clientRuntimeTimeoutMs'),
    maxClientSourceBytes: natural(record.maxClientSourceBytes, 'maxClientSourceBytes'),
    maxCordisNodes: natural(record.maxCordisNodes, 'maxCordisNodes'),
    maxDisconnectedCordisTrees: natural(record.maxDisconnectedCordisTrees, 'maxDisconnectedCordisTrees', true),
  }
}

/**
 * Decode one Host-to-Worker lifecycle command.
 * @param value - Untrusted control message.
 * @returns The validated Host command.
 */
export function parseInspectorHostControl(value: unknown): InspectorHostControl {
  const record = exactObject(value, ['type'], 'Host control message')
  if (record.type !== 'shutdown') throw new Error('inspector protocol: unknown Host control message')
  return { type: 'shutdown' }
}

/**
 * Decode one Worker-to-Host lifecycle event.
 * @param value - Untrusted control message.
 * @returns The validated Worker event.
 */
export function parseInspectorWorkerControl(value: unknown): InspectorWorkerControl {
  const record = exactObjectByType(value, 'Worker control message')
  switch (record.type) {
    case 'ready':
      exactKeys(record, ['type', 'host', 'port', 'targetId'], 'Worker ready message')
      if (typeof record.host !== 'string' || typeof record.targetId !== 'string') {
        throw new Error('inspector protocol: invalid Worker ready identity')
      }
      return {
        type: 'ready',
        host: record.host,
        port: natural(record.port, 'port', true),
        targetId: record.targetId,
      }
    case 'failure':
      exactKeys(record, ['type', 'message'], 'Worker failure message')
      if (typeof record.message !== 'string') throw new Error('inspector protocol: invalid Worker failure')
      return { type: 'failure', message: record.message }
    case 'stopped':
      exactKeys(record, ['type'], 'Worker stopped message')
      return { type: 'stopped' }
    default:
      throw new Error('inspector protocol: unknown Worker control message')
  }
}

/**
 * Decode bootstrap data injected into the browser global.
 * @param value - Untrusted injected value.
 * @returns The validated Client bootstrap.
 */
export function parseInspectorClientBootstrap(value: unknown): InspectorClientBootstrap {
  const record = exactObject(value, [
    'endpoint', 'protocol', 'maxQueuedRecords', 'maxQueuedBytes', 'maxRecordsPerFrame', 'maxFrameBytes',
    'reconnectBaseMs', 'reconnectMaxMs', 'queryTimeoutMs', 'maxRuntimeObjectsPerSession',
    'maxRuntimePropertiesPerResult', 'maxCordisNodes', 'maxClientSourceBytes',
  ], 'Client bootstrap')
  if (typeof record.endpoint !== 'string' || typeof record.protocol !== 'string') {
    throw new Error('inspector protocol: Client bootstrap endpoint and protocol must be strings')
  }
  let endpoint: URL
  try {
    endpoint = new URL(record.endpoint)
  } catch {
    throw new Error('inspector protocol: Client bootstrap endpoint must be an absolute URL')
  }
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1') {
    throw new Error('inspector protocol: Client bootstrap endpoint must use ws on 127.0.0.1')
  }
  if (record.protocol.length === 0 || record.protocol.length > 256) {
    throw new Error('inspector protocol: Client bootstrap protocol must contain 1 to 256 characters')
  }
  const bootstrap: InspectorClientBootstrap = {
    endpoint: record.endpoint,
    protocol: record.protocol,
    maxQueuedRecords: natural(record.maxQueuedRecords, 'maxQueuedRecords'),
    maxQueuedBytes: natural(record.maxQueuedBytes, 'maxQueuedBytes'),
    maxRecordsPerFrame: natural(record.maxRecordsPerFrame, 'maxRecordsPerFrame'),
    maxFrameBytes: natural(record.maxFrameBytes, 'maxFrameBytes'),
    reconnectBaseMs: natural(record.reconnectBaseMs, 'reconnectBaseMs'),
    reconnectMaxMs: natural(record.reconnectMaxMs, 'reconnectMaxMs'),
    queryTimeoutMs: natural(record.queryTimeoutMs, 'queryTimeoutMs'),
    maxRuntimeObjectsPerSession: natural(record.maxRuntimeObjectsPerSession, 'maxRuntimeObjectsPerSession'),
    maxRuntimePropertiesPerResult: natural(record.maxRuntimePropertiesPerResult, 'maxRuntimePropertiesPerResult'),
    maxClientSourceBytes: natural(record.maxClientSourceBytes, 'maxClientSourceBytes'),
    maxCordisNodes: natural(record.maxCordisNodes, 'maxCordisNodes'),
  }
  if (bootstrap.reconnectMaxMs < bootstrap.reconnectBaseMs) {
    throw new Error('inspector protocol: reconnectMaxMs must be at least reconnectBaseMs')
  }
  return bootstrap
}

function exactObjectByType(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value) || typeof value.type !== 'string') {
    throw new Error(`inspector protocol: ${label} must have a type`)
  }
  return value
}

function natural(value: unknown, label: string, zero = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (zero ? 0 : 1)) {
    throw new Error(`inspector protocol: ${label} must be ${zero ? 'a non-negative' : 'a positive'} safe integer`)
  }
  return value as number
}
