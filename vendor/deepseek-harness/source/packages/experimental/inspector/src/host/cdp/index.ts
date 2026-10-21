/** Source-side CDP capability declarations for the Host realm. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'
import { consoleBridgeCapability } from './console.ts'
import { debuggerBridgeCapability } from './debugger.ts'
import { heapProfilerBridgeCapability } from './heap-profiler.ts'
import { profilerBridgeCapability } from './profiler.ts'
import { runtimeBridgeCapability } from './runtime.ts'
import { sourcesBridgeCapability } from './sources.ts'

const HOST_BRIDGE_CAPABILITIES: readonly InspectorSourceCapability[] = [
  runtimeBridgeCapability(''),
  consoleBridgeCapability(),
  sourcesBridgeCapability(false),
  debuggerBridgeCapability(),
  profilerBridgeCapability(),
  heapProfilerBridgeCapability(),
].filter((capability): capability is InspectorSourceCapability => capability !== undefined)

/**
 * Collect Host source-bridge capabilities.
 * @param _origin - Unused Host origin supplied for parity with the Client adapter.
 * @param _hasSources - Unused source availability supplied for parity with the Client adapter.
 * @returns No capabilities because the Worker attaches to Host V8 directly.
 */
export function bridgeCapabilities(_origin: string, _hasSources: boolean): readonly InspectorSourceCapability[] {
  return HOST_BRIDGE_CAPABILITIES
}
