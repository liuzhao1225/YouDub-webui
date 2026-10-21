/** Opaque identifiers owned by one Worker-side Chrome DevTools connection. */

import type { InspectorId } from '../../shared/identity.ts'

declare const cdpNumericIdBrand: unique symbol

/** Number branded with one Chrome CDP identity role. */
export type CdpNumericId<Role extends string> = number & { readonly [cdpNumericIdBrand]: Role }

/** Identity of one DevTools connection inside the Worker. */
export type InspectorConnectionId = InspectorId<'InspectorConnectionId'>

/** Runtime object id scoped to one DevTools connection. */
export type CdpRemoteObjectId = InspectorId<'CdpRemoteObjectId'>

/** Debugger script id scoped to one DevTools connection. */
export type CdpScriptId = InspectorId<'CdpScriptId'>

/** Debugger call-frame id scoped to one paused DevTools session. */
export type CdpCallFrameId = InspectorId<'CdpCallFrameId'>

/** Runtime execution-context id scoped to one DevTools target. */
export type CdpExecutionContextId = CdpNumericId<'CdpExecutionContextId'>

/** DOM frontend node id scoped to one DevTools document. */
export type CdpNodeId = CdpNumericId<'CdpNodeId'>

/** DOM backend node id stable across connection-local document projections. */
export type CdpBackendNodeId = CdpNumericId<'CdpBackendNodeId'>

/**
 * Validate and brand a string id allocated or accepted by the CDP adapter.
 * @param value - CDP identifier text.
 * @param label - Field named in validation failures.
 * @returns The branded CDP identifier.
 */
export function cdpStringId<Role extends string>(value: string, label: string): InspectorId<Role> {
  if (value.length === 0 || value.length > 16_384) {
    throw new Error(`inspector CDP: ${label} must contain 1 to 16384 characters`)
  }
  return value as InspectorId<Role>
}

/**
 * Validate and brand a positive numeric id allocated by the CDP adapter.
 * @param value - CDP identifier number.
 * @param label - Field named in validation failures.
 * @returns The branded numeric identifier.
 */
export function cdpNumericId<Role extends string>(value: number, label: string): CdpNumericId<Role> {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`inspector CDP: ${label} must be a positive integer`)
  return value as CdpNumericId<Role>
}
