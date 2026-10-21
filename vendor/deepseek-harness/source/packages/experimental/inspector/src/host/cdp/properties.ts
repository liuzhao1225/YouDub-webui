/** Host property enumeration never crosses the Host source bridge. */

import { rejectObjectBridgeOperation } from './objects.ts'

/**
 * Reject a property request that must use the Worker-owned native inspector session.
 * @returns This function never returns.
 */
export function rejectPropertyBridgeOperation(): never {
  return rejectObjectBridgeOperation('client-runtime/get-properties')
}
