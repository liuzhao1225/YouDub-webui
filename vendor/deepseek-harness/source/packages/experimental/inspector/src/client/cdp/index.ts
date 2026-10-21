/** Source-side CDP capability declarations for the browser Client realm. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'
import { consoleBridgeCapability } from './console.ts'
import { debuggerBridgeCapability } from './debugger.ts'
import { heapProfilerBridgeCapability } from './heap-profiler.ts'
import { profilerBridgeCapability } from './profiler.ts'
import { runtimeBridgeCapability } from './runtime.ts'
import { sourcesBridgeCapability } from './sources.ts'

/**
 * Describe Client operations that require Worker-to-page bridge messages.
 * @param origin - Origin assigned to the synthetic execution context.
 * @param hasSources - Whether the Client bundle source was discovered.
 * @returns Capabilities included in the Client source handshake.
 */
export function bridgeCapabilities(origin: string, hasSources: boolean): readonly InspectorSourceCapability[] {
  return [
    runtimeBridgeCapability(origin),
    consoleBridgeCapability(),
    sourcesBridgeCapability(hasSources),
    debuggerBridgeCapability(),
    profilerBridgeCapability(),
    heapProfilerBridgeCapability(),
  ].filter((capability): capability is InspectorSourceCapability => capability !== undefined)
}
