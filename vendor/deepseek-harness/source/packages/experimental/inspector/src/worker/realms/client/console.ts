/** ConsoleBackend over the typed Client Console event transport. */

import type { ClientRuntimeSessionId } from '../../../shared/bridge/ids.ts'
import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import type { RuntimeConsoleBackendEvent } from '../../../shared/cdp/index.ts'
import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ConsoleBackend } from '../../../shared/cdp/realm.ts'
import { clientConsoleEvent } from './values.ts'
import type { ClientScriptIdentity } from './scripts.ts'

/** Adapts session-local Client Console events to common Runtime values. */
export class ClientConsoleBackend implements ConsoleBackend {
  private readonly disposers = new Set<() => void>()

  constructor(
    private readonly target: ClientRuntimeTarget,
    private readonly sessionId: ClientRuntimeSessionId,
    private readonly router: ClientRuntimeRouter,
    private readonly scriptIds: ClientScriptIdentity,
  ) {}

  subscribe(listener: (event: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>) => void): () => void {
    const dispose = this.router.subscribeConsole(this.target, this.sessionId, (event) => {
      listener(clientConsoleEvent(event, scriptKey => this.scriptIds.toRuntime(scriptKey)))
    })
    this.disposers.add(dispose)
    return () => {
      if (!this.disposers.delete(dispose)) return
      dispose()
    }
  }

  async clear(): Promise<void> {}

  /** Disable every active Console subscription for this connection. */
  close(): void {
    for (const dispose of this.disposers) dispose()
    this.disposers.clear()
  }
}
