/** Realm-stable translation between Client catalog keys and common Runtime script keys. */

import { inspectorId } from '../../../shared/identity.ts'
import type { RuntimeScriptKey } from '../../../shared/cdp/ids.ts'

/** Allocates one shared script identity namespace for all backends in a Client realm. */
export class ClientScriptIdentity {
  private readonly publicByLocal = new Map<RuntimeScriptKey, RuntimeScriptKey>()

  constructor(private readonly contextId: number) {}

  /**
   * Convert a Client-local key to the realm's public Runtime script key.
   * @param localKey - Script key used on the Client wire.
   * @returns Stable key shared by this realm's Runtime, Console, and Sources backends.
   */
  toRuntime(localKey: RuntimeScriptKey): RuntimeScriptKey {
    let scriptKey = this.publicByLocal.get(localKey)
    if (scriptKey !== undefined) return scriptKey
    scriptKey = inspectorId<'RuntimeScriptKey'>(
      `client:${String(Math.abs(this.contextId))}:${String(this.publicByLocal.size + 1)}`,
      'scriptKey',
    )
    this.publicByLocal.set(localKey, scriptKey)
    return scriptKey
  }
}
