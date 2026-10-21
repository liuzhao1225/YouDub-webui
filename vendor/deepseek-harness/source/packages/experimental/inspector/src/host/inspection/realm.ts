/** Stable descriptor for the Host observation source generation. */

import { randomUUID } from 'node:crypto'
import { inspectorId } from '../../shared/identity.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { bridgeCapabilities } from '../cdp/index.ts'

/**
 * Create the descriptor for one Host-to-Worker MessagePort generation.
 * @param label - Human-readable Host execution-context label.
 * @returns The complete Host source descriptor.
 */
export function createHostRealmSource(label: string): InspectorSourceDescriptor {
  return {
    sourceId: inspectorId<'InspectorSourceId'>(`host-${randomUUID()}`, 'sourceId'),
    generation: inspectorId<'InspectorSourceGeneration'>(randomUUID(), 'generation'),
    kind: 'host',
    label,
    timeOriginMs: performance.timeOrigin,
    capabilities: bridgeCapabilities('', false),
  }
}
