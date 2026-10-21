/** Worker-side bridge dependencies for one connected Client realm. */

import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ClientSourceRouter } from '../../bridge/source-rpc.ts'

/** Typed bridge services used by all Client realm backend adapters. */
export interface ClientRealmBridge {
  readonly target: ClientRuntimeTarget
  readonly runtime: ClientRuntimeRouter
  readonly sources: ClientSourceRouter
}

/**
 * Bind one Client source generation to the Worker bridge services that can address it.
 * @param target - Active Client source generation and execution context.
 * @param runtime - Runtime and Console RPC router.
 * @param sources - Source-catalog RPC router.
 * @returns The immutable Client realm bridge.
 */
export function createClientRealmBridge(
  target: ClientRuntimeTarget,
  runtime: ClientRuntimeRouter,
  sources: ClientSourceRouter,
): ClientRealmBridge {
  return { target, runtime, sources }
}
