/** Client CPU profiling is not exposed by the source bridge. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'

/**
 * Describe unavailable browser-side CPU profiling.
 * @returns No source capability for Client CPU profiling.
 */
export function profilerBridgeCapability(): InspectorSourceCapability | undefined {
  return undefined
}
