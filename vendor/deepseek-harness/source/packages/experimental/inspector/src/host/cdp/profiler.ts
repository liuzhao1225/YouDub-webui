/** Host CPU profiling is served directly by the Worker-side Node inspector adapter. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'

/**
 * Describe Host CPU profiler transport ownership.
 * @returns No Host-main-thread Profiler bridge capability.
 */
export function profilerBridgeCapability(): InspectorSourceCapability | undefined {
  return undefined
}
