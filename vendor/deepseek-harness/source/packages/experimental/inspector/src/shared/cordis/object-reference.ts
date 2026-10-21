/** Opaque references to live objects retained inside an observation source realm. */

import type { InspectorObjectHandle, InspectorObjectRegistryId } from './ids.ts'
import { exactObject, wireId } from '../validation.ts'

/** Wire-safe identity of one live object; the source generation supplies the realm identity. */
export interface InspectorObjectReference {
  readonly registryId: InspectorObjectRegistryId
  readonly handle: InspectorObjectHandle
}

/**
 * Decode one source-local live-object reference.
 * @param value - Untrusted wire value.
 * @returns The validated opaque reference.
 */
export function parseInspectorObjectReference(value: unknown): InspectorObjectReference {
  const record = exactObject(value, ['registryId', 'handle'], 'object reference')
  return {
    registryId: wireId<'InspectorObjectRegistryId'>(record.registryId, 'registryId'),
    handle: wireId<'InspectorObjectHandle'>(record.handle, 'handle'),
  }
}
