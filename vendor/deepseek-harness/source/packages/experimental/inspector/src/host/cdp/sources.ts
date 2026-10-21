/** Host Sources are served directly by the Worker-side Node inspector adapter. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'

/**
 * Describe Host Sources transport ownership.
 * @param _available - Ignored because Host Sources do not cross the source bridge.
 * @returns No Host-main-thread Sources bridge capability.
 */
export function sourcesBridgeCapability(_available: boolean): InspectorSourceCapability | undefined {
  return undefined
}

/**
 * Reject a Client Sources request that was routed to the Host source.
 * @returns This function never returns.
 */
export function rejectSourcesBridgeCommand(): never {
  throw new Error('inspector protocol: Client Sources cannot use the Host source bridge')
}
