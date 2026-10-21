/** Explicit Client debugger capability until a pause-safe page agent exists. */

import type { DebuggerBackend, RealmCapability } from '../../../shared/cdp/realm.ts'

/**
 * Report the unavailable Client debugger backend.
 * @returns The typed unsupported result used by every Client realm session.
 */
export function clientDebuggerCapability(): RealmCapability<DebuggerBackend> {
  return { state: 'unsupported', reason: 'Client native debugging is unavailable' }
}
