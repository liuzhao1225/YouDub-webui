/** Dispatch of validated Worker frames accepted by the Host MessagePort. */

import type {
  SourceAcceptedFrame,
  SourceAppendAcknowledgedFrame,
  SourceRejectedFrame,
  SourceResnapshotFrame,
  WorkerToSourceFrame,
} from '../../shared/bridge/messages/observation.ts'
import { rejectConsoleBridgeCommand } from '../cdp/console.ts'
import { rejectRuntimeBridgeCommand } from '../cdp/runtime.ts'
import { rejectSourcesBridgeCommand } from '../cdp/sources.ts'

/** Operations invoked for source-lifecycle frames addressed to the Host. */
export interface HostBridgeFrameHandlers {
  accepted(frame: SourceAcceptedFrame): void
  acknowledged(frame: SourceAppendAcknowledgedFrame): void
  resnapshot(frame: SourceResnapshotFrame): void
  rejected(frame: SourceRejectedFrame): void
}

/**
 * Dispatch one validated Worker frame and reject Client-only commands on the Host carrier.
 * @param frame - Decoded Worker-to-source frame.
 * @param handlers - Host source-lifecycle operations.
 */
export function dispatchBridgeFrame(frame: WorkerToSourceFrame, handlers: HostBridgeFrameHandlers): void {
  switch (frame.t) {
    case 'source/accepted':
      handlers.accepted(frame)
      return
    case 'source/append-acknowledged':
      handlers.acknowledged(frame)
      return
    case 'source/resnapshot':
      handlers.resnapshot(frame)
      return
    case 'source/rejected':
      handlers.rejected(frame)
      return
    case 'client-runtime/request':
      return rejectRuntimeBridgeCommand(frame.command)
    case 'client-runtime/cancel':
    case 'client-runtime/response-acknowledged':
      return
    case 'client-console/enable':
    case 'client-console/disable':
      return rejectConsoleBridgeCommand(frame.t)
    case 'client-sources/request':
      return rejectSourcesBridgeCommand()
    case 'client-runtime/session-closed':
    case 'client-sources/session-closed':
      return
    default:
      return assertNever(frame)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Worker source frame: ${JSON.stringify(value)}`)
}
