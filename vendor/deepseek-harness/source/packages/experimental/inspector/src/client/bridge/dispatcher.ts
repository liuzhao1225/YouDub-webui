/** Dispatch of validated Worker frames to browser-realm capability handlers. */

import type {
  ClientConsoleDisableFrame,
  ClientConsoleEnableFrame,
  ClientRuntimeCancelFrame,
  ClientRuntimeRequestFrame,
  ClientRuntimeResponseAcknowledgedFrame,
  ClientRuntimeSessionClosedFrame,
} from '../../shared/bridge/messages/runtime/index.ts'
import type { ClientSourceRequestFrame, ClientSourceSessionClosedFrame } from '../../shared/bridge/messages/sources/index.ts'
import type {
  SourceAcceptedFrame,
  SourceAppendAcknowledgedFrame,
  SourceRejectedFrame,
  SourceResnapshotFrame,
  WorkerToSourceFrame,
} from '../../shared/bridge/messages/observation.ts'

/** Operations invoked for each Worker-to-Client frame family. */
export interface ClientBridgeFrameHandlers {
  accepted(frame: SourceAcceptedFrame): void
  acknowledged(frame: SourceAppendAcknowledgedFrame): void
  resnapshot(frame: SourceResnapshotFrame): void
  rejected(frame: SourceRejectedFrame): void
  runtime(frame: ClientRuntimeRequestFrame): void
  runtimeCanceled(frame: ClientRuntimeCancelFrame): void
  runtimeAcknowledged(frame: ClientRuntimeResponseAcknowledgedFrame): void
  runtimeClosed(frame: ClientRuntimeSessionClosedFrame): void
  consoleEnabled(frame: ClientConsoleEnableFrame): void
  consoleDisabled(frame: ClientConsoleDisableFrame): void
  sources(frame: ClientSourceRequestFrame): void
  sourcesClosed(frame: ClientSourceSessionClosedFrame): void
}

/**
 * Dispatch one validated Worker frame without exposing transport details to domain adapters.
 * @param frame - Decoded Worker-to-source frame.
 * @param handlers - Browser-realm operations for each frame family.
 */
export function dispatchBridgeFrame(frame: WorkerToSourceFrame, handlers: ClientBridgeFrameHandlers): void {
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
      handlers.runtime(frame)
      return
    case 'client-runtime/cancel':
      handlers.runtimeCanceled(frame)
      return
    case 'client-runtime/response-acknowledged':
      handlers.runtimeAcknowledged(frame)
      return
    case 'client-runtime/session-closed':
      handlers.runtimeClosed(frame)
      return
    case 'client-console/enable':
      handlers.consoleEnabled(frame)
      return
    case 'client-console/disable':
      handlers.consoleDisabled(frame)
      return
    case 'client-sources/request':
      handlers.sources(frame)
      return
    case 'client-sources/session-closed':
      handlers.sourcesClosed(frame)
      return
    default:
      return assertNever(frame)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Worker source frame: ${JSON.stringify(value)}`)
}
