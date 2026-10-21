/** Client heap profiling is not exposed by the source bridge. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'

/**
 * Describe unavailable browser-side heap profiling.
 * @returns No source capability for Client heap profiling.
 */
export function heapProfilerBridgeCapability(): InspectorSourceCapability | undefined {
  return undefined
}
