/** Wire messages for Gateway-owned Remote streams and notifications. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol'

/** Exact WebSocket route carrying every Typert Remote stream. */
export const REMOTE_STREAM_MUX_PATH = '/api/remote.mux'

/** Gateway-internal logical stream carrying application-selected Cordis events. */
export const REMOTE_EVENT_STREAM_ENDPOINT = '$events'

/** Empty standard Remote payload used to open the forwarded-event stream. */
export const REMOTE_EVENT_STREAM_PAYLOAD = { args: {} } as const

/** Discriminator for the first item proving the Host event source is ready. */
export const REMOTE_EVENT_STREAM_READY = { type: 'ready' } as const

/** Opaque identity for one active Client Remote Event generation. */
export type RemoteEventClientId = Branded<'RemoteEventClientId'>

/** Stable Host facts published with every established Client event generation. */
export interface RemoteEventHostInfo {
  /** Host account home used only to abbreviate displayed filesystem paths. */
  readonly home: string
}

/** Opening item that binds later HTTP results to this active event stream. */
export interface RemoteEventReadyFrame {
  readonly type: 'ready'
  readonly clientId: RemoteEventClientId
  /** Stable Host facts attached to this connection generation. */
  readonly host: RemoteEventHostInfo
}

/** One Host notification delivered to a Client generation. */
export interface RemoteEventEmitFrame {
  readonly type: 'emit'
  readonly event: string
  readonly args: readonly unknown[]
}

/** Every item carried by the Gateway-internal forwarded-event stream. */
export type RemoteEventDownlinkFrame = RemoteEventReadyFrame | RemoteEventEmitFrame

/** Recognize the identity for one event-stream generation. */
export function isRemoteEventClientId(value: unknown): value is RemoteEventClientId {
  return typeof value === 'string' && value.length > 0
}

/** One logical stream request sent from the browser: open, one uplink item, uplink half-close, or cancel. */
export type RemoteStreamClientMessage =
  | {
    readonly type: 'open'
    readonly streamId: string
    readonly endpoint: string
    readonly payload: unknown
  }
  | { readonly type: 'item'; readonly streamId: string; readonly value?: unknown }
  | { readonly type: 'end'; readonly streamId: string }
  | { readonly type: 'cancel'; readonly streamId: string }

/** Carrier-safe failure delivered by the Host. */
export interface RemoteStreamFailure {
  readonly code: string
  readonly message: string
  readonly details: object
}

/** One logical stream frame sent from the Host. */
export type RemoteStreamServerMessage =
  | { readonly type: 'item'; readonly streamId: string; readonly value?: unknown }
  | { readonly type: 'error'; readonly streamId: string; readonly error: RemoteStreamFailure }
  | { readonly type: 'end'; readonly streamId: string }

/**
 * Parse and validate one browser-to-Host text message.
 * @param text - complete WebSocket text message.
 * @returns the validated logical-stream request.
 */
export function parseRemoteStreamClientMessage(text: string): RemoteStreamClientMessage {
  return parseMessage(text, (value) => {
    if ((value.type === 'cancel' || value.type === 'end')
      && exactKeys(value, ['type', 'streamId'])
      && validId(value.streamId)) {
      return value as RemoteStreamClientMessage
    }
    if (value.type === 'item'
      && (exactKeys(value, ['type', 'streamId']) || exactKeys(value, ['type', 'streamId', 'value']))
      && validId(value.streamId)
      && (!Object.hasOwn(value, 'value') || isRemoteJsonValue(value.value))) {
      return value as RemoteStreamClientMessage
    }
    if (value.type === 'open'
      && exactKeys(value, ['type', 'streamId', 'endpoint', 'payload'])
      && validId(value.streamId)
      && typeof value.endpoint === 'string'
      && value.endpoint.length > 0) {
      return value as RemoteStreamClientMessage
    }
    throw new Error('api gateway: invalid Remote stream client message')
  })
}

/**
 * Parse and validate one Host-to-browser text message.
 * @param text - complete WebSocket text message.
 * @returns the validated logical-stream frame.
 */
export function parseRemoteStreamServerMessage(text: string): RemoteStreamServerMessage {
  return parseMessage(text, (value) => {
    if (value.type === 'item'
      && (exactKeys(value, ['type', 'streamId']) || exactKeys(value, ['type', 'streamId', 'value']))
      && validId(value.streamId)) {
      return value as RemoteStreamServerMessage
    }
    if (value.type === 'end' && exactKeys(value, ['type', 'streamId']) && validId(value.streamId)) {
      return value as RemoteStreamServerMessage
    }
    if (value.type === 'error'
      && exactKeys(value, ['type', 'streamId', 'error'])
      && validId(value.streamId)
      && isRecord(value.error)
      && exactKeys(value.error, ['code', 'message', 'details'])
      && typeof value.error.code === 'string'
      && typeof value.error.message === 'string'
      && isRecord(value.error.details)) {
      return value as RemoteStreamServerMessage
    }
    throw new Error('api gateway: invalid Remote stream server message')
  })
}

function parseMessage<T>(text: string, validate: (value: Record<string, unknown>) => T): T {
  let decoded: unknown
  try {
    decoded = JSON.parse(text) as unknown
  } catch (cause) {
    throw new Error('api gateway: Remote stream message is not JSON', { cause })
  }
  if (!isRecord(decoded)) throw new Error('api gateway: Remote stream message must be an object')
  return validate(decoded)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key))
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
