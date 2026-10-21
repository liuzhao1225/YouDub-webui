/** Host heap profiling is served directly by the Worker-side Node inspector adapter. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'

/**
 * Describe Host heap profiler transport ownership.
 * @returns No Host-main-thread HeapProfiler bridge capability.
 */
export function heapProfilerBridgeCapability(): InspectorSourceCapability | undefined {
  return undefined
}
