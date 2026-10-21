/** Explicit failure for Client-style CDP bridge commands misrouted to the Host. */

import { HOST_CDP_BRIDGE_REASON } from './stack.ts'

/** Host Runtime uses the Worker-side Node inspector session instead of source RPC. */
export class HostCdpBridgeUnavailableError extends Error {
  constructor(operation: string) {
    super(`inspector protocol: ${operation} cannot use the Host source bridge; ${HOST_CDP_BRIDGE_REASON}`)
  }
}
