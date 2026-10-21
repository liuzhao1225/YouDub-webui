/** Client Runtime failures that belong to the transport rather than evaluated JavaScript. */

import type { ClientRuntimeError } from '../../shared/bridge/messages/runtime/index.ts'

/** Failure returned through the typed Client Runtime error outcome. */
export class ClientRuntimeExecutionError extends Error {
  constructor(readonly code: ClientRuntimeError['code'], message: string) {
    super(message)
  }
}
