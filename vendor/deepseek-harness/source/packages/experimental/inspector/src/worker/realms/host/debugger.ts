/** DebuggerBackend implementation over one native Node inspector session. */

import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import { isJsonValue } from '../../../shared/json.ts'
import type {
  RuntimeDebuggerCallFrame,
  RuntimeDebuggerEvent,
  RuntimeDebuggerLocation,
  RuntimeDebuggerScope,
} from '../../../shared/cdp/index.ts'
import type { DebuggerBackend } from '../../../shared/cdp/realm.ts'
import type { HostInspectorSession } from './bridge.ts'
import { optionalNativeField, requireNativeRecord } from './values.ts'
import { HostNotificationChannel } from './bridge.ts'
import type { HostRuntimeBackend } from './runtime.ts'
import { hostScriptKey } from './scripts.ts'

/** Native Host debugger adapted to common commands, Runtime values, and events. */
export class HostDebuggerBackend implements DebuggerBackend {
  private readonly events: HostNotificationChannel<RuntimeDebuggerEvent<RuntimeBackendObjectHandle>>

  constructor(
    private readonly target: HostInspectorSession,
    private readonly runtime: HostRuntimeBackend,
  ) {
    this.events = new HostNotificationChannel(
      target,
      message => message.method === 'Debugger.resumed'
        || message.method === 'Debugger.breakpointResolved'
        || message.method === 'Debugger.paused',
      async message => message.method === 'Debugger.resumed'
        ? { type: 'resumed' }
        : message.method === 'Debugger.breakpointResolved'
          ? breakpointResolved(message.params)
          : this.paused(message.params),
    )
  }

  async enable(request: Parameters<DebuggerBackend['enable']>[0]): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.enable', {
      ...optionalNativeField('maxScriptsCacheSize', request.maxScriptsCacheSize),
    })
  }

  async disable(): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.disable', {})
  }

  async pause(): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.pause', {})
  }

  async resume(request: Parameters<DebuggerBackend['resume']>[0]): Promise<Readonly<Record<string, unknown>>> {
    return this.target.request('Debugger.resume', {
      ...optionalNativeField('terminateOnResume', request.terminateOnResume),
    })
  }

  async evaluateOnCallFrame(
    request: Parameters<DebuggerBackend['evaluateOnCallFrame']>[0],
  ): ReturnType<DebuggerBackend['evaluateOnCallFrame']> {
    return this.runtime.completion(await this.target.request('Debugger.evaluateOnCallFrame', {
      callFrameId: request.callFrameId,
      expression: request.expression,
      ...optionalNativeField('objectGroup', request.objectGroup),
      ...optionalNativeField('includeCommandLineAPI', request.includeCommandLineAPI),
      ...optionalNativeField('silent', request.silent),
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('throwOnSideEffect', request.throwOnSideEffect),
      ...optionalNativeField('timeout', request.timeoutMs),
    }))
  }

  subscribe(listener: (event: RuntimeDebuggerEvent<RuntimeBackendObjectHandle>) => void): () => void {
    return this.events.subscribe(listener)
  }

  /** Release the native notification subscription. */
  close(): void {
    this.events.close()
  }

  private async paused(
    params: Readonly<Record<string, unknown>> | undefined,
  ): Promise<RuntimeDebuggerEvent<RuntimeBackendObjectHandle> | undefined> {
    if (!Array.isArray(params?.callFrames) || typeof params.reason !== 'string') return undefined
    const callFrames = await Promise.all(params.callFrames.map(async frame => this.callFrame(frame)))
    const data = params.data
    const hitBreakpoints = params.hitBreakpoints
    return {
      type: 'paused',
      callFrames,
      reason: params.reason,
      ...(data === undefined || !isJsonValue(data) ? {} : { data }),
      ...(isStringArray(hitBreakpoints)
        ? { hitBreakpoints: hitBreakpoints }
        : {}),
      ...(params.asyncStackTrace === undefined
        ? {}
        : { asyncStackTrace: this.runtime.stackTrace(params.asyncStackTrace) }),
    }
  }

  private async callFrame(value: unknown): Promise<RuntimeDebuggerCallFrame<RuntimeBackendObjectHandle>> {
    const record = requireNativeRecord(value, 'Host Debugger call frame')
    if (typeof record.callFrameId !== 'string'
      || typeof record.functionName !== 'string'
      || typeof record.url !== 'string'
      || !Array.isArray(record.scopeChain)) {
      throw new Error('Host Debugger returned an invalid call frame')
    }
    return {
      callFrameId: record.callFrameId,
      functionName: record.functionName,
      ...(record.functionLocation === undefined ? {} : { functionLocation: location(record.functionLocation) }),
      location: location(record.location),
      url: record.url,
      scopeChain: await Promise.all(record.scopeChain.map(async scope => this.scope(scope))),
      thisObject: await this.runtime.remoteObject(record.this),
      ...(record.returnValue === undefined ? {} : { returnValue: await this.runtime.remoteObject(record.returnValue) }),
    }
  }

  private async scope(value: unknown): Promise<RuntimeDebuggerScope<RuntimeBackendObjectHandle>> {
    const record = requireNativeRecord(value, 'Host Debugger scope')
    if (typeof record.type !== 'string') throw new Error('Host Debugger returned an invalid scope')
    return {
      type: record.type,
      object: await this.runtime.remoteObject(record.object),
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(record.startLocation === undefined ? {} : { startLocation: location(record.startLocation) }),
      ...(record.endLocation === undefined ? {} : { endLocation: location(record.endLocation) }),
    }
  }

}

function breakpointResolved(
  params: Readonly<Record<string, unknown>> | undefined,
): Extract<RuntimeDebuggerEvent<RuntimeBackendObjectHandle>, { type: 'breakpoint-resolved' }> | undefined {
  if (typeof params?.breakpointId !== 'string' || params.location === undefined) return undefined
  return {
    type: 'breakpoint-resolved',
    breakpointId: params.breakpointId,
    location: location(params.location),
  }
}

function location(value: unknown): RuntimeDebuggerLocation {
  const record = requireNativeRecord(value, 'Host Debugger location')
  if (typeof record.scriptId !== 'string' || !Number.isSafeInteger(record.lineNumber)) {
    throw new Error('Host Debugger returned an invalid location')
  }
  if (record.columnNumber !== undefined && !Number.isSafeInteger(record.columnNumber)) {
    throw new Error('Host Debugger returned an invalid location column')
  }
  return {
    scriptKey: hostScriptKey(record.scriptId),
    lineNumber: record.lineNumber as number,
    ...(record.columnNumber === undefined ? {} : { columnNumber: record.columnNumber as number }),
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
