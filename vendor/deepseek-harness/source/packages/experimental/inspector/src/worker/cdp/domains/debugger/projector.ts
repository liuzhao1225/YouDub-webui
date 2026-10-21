/** CDP projection for realm-neutral scripts and debugger events. */

import type { RuntimeDebuggerEvent, RuntimeDebuggerLocation, RuntimeScript, RuntimeStackTrace } from '../../../../shared/cdp/index.ts'
import type { RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import type { CdpNotification } from '../../protocol.ts'
import type { InspectorRealmSession } from '../../../inspection/realm.ts'
import type { RuntimeDomainSession } from '../runtime/index.ts'
import { cdpScriptId } from './script-registry.ts'

/**
 * Project one common script descriptor to Debugger.scriptParsed.
 * @param realm - Realm session that owns the script.
 * @param script - Realm-neutral script descriptor.
 * @returns A CDP scriptParsed notification.
 */
export function scriptParsedEvent(realm: InspectorRealmSession, script: RuntimeScript): CdpNotification {
  return {
    method: 'Debugger.scriptParsed',
    params: {
      scriptId: cdpScriptId(script.scriptKey),
      url: script.url,
      startLine: script.startLine,
      startColumn: script.startColumn,
      endLine: script.endLine,
      endColumn: script.endColumn,
      executionContextId: script.executionContextId
        ?? (realm.context.kind === 'synthetic' ? realm.context.id : 0),
      hash: script.hash,
      buildId: script.buildId ?? '',
      ...(script.sourceMapUrl === undefined ? {} : { sourceMapURL: script.sourceMapUrl }),
      ...(script.isModule === undefined ? {} : { isModule: script.isModule }),
      ...(script.length === undefined ? {} : { length: script.length }),
    },
  }
}

/**
 * Project one common debugger event and all nested Runtime objects to CDP.
 * @param realm - Realm session that emitted the event.
 * @param event - Realm-neutral debugger event.
 * @param runtime - Connection-local Runtime object projector.
 * @returns The corresponding CDP notification.
 */
export function debuggerEvent(
  realm: InspectorRealmSession,
  event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>,
  runtime: RuntimeDomainSession,
): CdpNotification {
  switch (event.type) {
    case 'paused':
      return {
        method: 'Debugger.paused',
        params: {
          callFrames: event.callFrames.map(frame => ({
            callFrameId: frame.callFrameId,
            functionName: frame.functionName,
            ...(frame.functionLocation === undefined ? {} : { functionLocation: location(frame.functionLocation) }),
            location: location(frame.location),
            url: frame.url,
            scopeChain: frame.scopeChain.map(scope => ({
              type: scope.type,
              object: runtime.projectRemoteObject(realm, scope.object, 'backtrace'),
              ...(scope.name === undefined ? {} : { name: scope.name }),
              ...(scope.startLocation === undefined ? {} : { startLocation: location(scope.startLocation) }),
              ...(scope.endLocation === undefined ? {} : { endLocation: location(scope.endLocation) }),
            })),
            this: runtime.projectRemoteObject(realm, frame.thisObject, 'backtrace'),
            ...(frame.returnValue === undefined
              ? {}
              : { returnValue: runtime.projectRemoteObject(realm, frame.returnValue, 'backtrace') }),
          })),
          reason: event.reason,
          ...(event.data === undefined ? {} : { data: event.data }),
          ...(event.hitBreakpoints === undefined ? {} : { hitBreakpoints: event.hitBreakpoints }),
          ...(event.asyncStackTrace === undefined ? {} : { asyncStackTrace: stackTrace(event.asyncStackTrace) }),
        },
      }
    case 'resumed':
      return { method: 'Debugger.resumed', params: {} }
    case 'breakpoint-resolved':
      return {
        method: 'Debugger.breakpointResolved',
        params: { breakpointId: event.breakpointId, location: location(event.location) },
      }
    default:
      return assertNever(event)
  }
}

function location(value: RuntimeDebuggerLocation): Readonly<Record<string, unknown>> {
  return {
    scriptId: cdpScriptId(value.scriptKey),
    lineNumber: value.lineNumber,
    ...(value.columnNumber === undefined ? {} : { columnNumber: value.columnNumber }),
  }
}

function stackTrace(value: RuntimeStackTrace): Readonly<Record<string, unknown>> {
  return {
    ...(value.description === undefined ? {} : { description: value.description }),
    callFrames: value.callFrames.map(frame => ({
      functionName: frame.functionName,
      scriptId: frame.scriptKey === undefined ? '0' : cdpScriptId(frame.scriptKey),
      url: frame.url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
    })),
    ...(value.parent === undefined ? {} : { parent: stackTrace(value.parent) }),
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected debugger event: ${JSON.stringify(value)}`)
}
