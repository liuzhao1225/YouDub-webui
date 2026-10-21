/** Host Console is served directly by the Worker-side Node inspector adapter. */

import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'

/**
 * Describe Host Console transport ownership.
 * @returns No Host-main-thread Console bridge capability.
 */
export function consoleBridgeCapability(): InspectorSourceCapability | undefined {
  return undefined
}

/**
 * Reject a Client Console control frame that was routed to the Host source.
 * @param operation - Misrouted Console frame type.
 * @returns This function never returns.
 */
export function rejectConsoleBridgeCommand(operation: string): never {
  throw new Error(`inspector protocol: ${operation} cannot use the Host source bridge`)
}
