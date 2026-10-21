/** Host-native script identity conversion for normalized source and debugger values. */

import { inspectorId } from '../../../shared/identity.ts'
import type { RuntimeScriptKey } from '../../../shared/cdp/ids.ts'

/**
 * Convert a Node inspector script id into the realm backend identity namespace.
 * @param value - Native Node inspector script id.
 * @returns The corresponding normalized script key.
 */
export function hostScriptKey(value: string): RuntimeScriptKey {
  return inspectorId<'RuntimeScriptKey'>(value, 'scriptKey')
}
