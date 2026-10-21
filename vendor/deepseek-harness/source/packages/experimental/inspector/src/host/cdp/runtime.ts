/** Host Runtime is served directly by the Worker-side Node inspector adapter. */

import type { ClientRuntimeCommand } from '../../shared/bridge/messages/runtime/index.ts'
import type { InspectorSourceCapability } from '../../shared/bridge/messages/observation.ts'
import { HostCdpBridgeUnavailableError } from './errors.ts'
import { rejectObjectBridgeOperation } from './objects.ts'
import { rejectPropertyBridgeOperation } from './properties.ts'

/**
 * Describe Host Runtime transport ownership.
 * @param _origin - Ignored because Host Runtime does not cross the source bridge.
 * @returns No Host-main-thread Runtime bridge capability.
 */
export function runtimeBridgeCapability(_origin: string): InspectorSourceCapability | undefined {
  return undefined
}

/**
 * Reject a Client Runtime command that was routed to the Host source.
 * @param command - Misrouted Client Runtime operation.
 * @returns This function never returns.
 */
export function rejectRuntimeBridgeCommand(command: ClientRuntimeCommand): never {
  switch (command.op) {
    case 'get-properties':
      return rejectPropertyBridgeOperation()
    case 'release-object':
    case 'release-object-group':
      return rejectObjectBridgeOperation(`client-runtime/${command.op}`)
    case 'evaluate':
    case 'call-function':
    case 'await-promise':
    case 'global-lexical-scope-names':
      throw new HostCdpBridgeUnavailableError(`client-runtime/${command.op}`)
    default:
      return assertNever(command)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Host Runtime bridge command: ${JSON.stringify(value)}`)
}
