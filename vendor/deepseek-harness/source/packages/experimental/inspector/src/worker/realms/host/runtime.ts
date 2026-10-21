/** RuntimeBackend implementation over one native Node inspector session. */

import { inspectorId } from '../../../shared/identity.ts'
import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import { isJsonValue } from '../../../shared/json.ts'
import { IDENTIFY_REALM_OBJECT_FUNCTION } from '../../../shared/cordis/object-registry.ts'
import { parseInspectorObjectReference, type InspectorObjectReference } from '../../../shared/cordis/object-reference.ts'
import type {
  RuntimeCallArgument,
  RuntimeCompletion,
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimePrivatePropertyDescriptor,
  RuntimeProperties,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
  RuntimeRemoteObjectDescriptor,
  RuntimeExecutionContext,
  RuntimeStackTrace,
} from '../../../shared/cdp/index.ts'
import type { HostInspectorNotification, HostInspectorSession } from './bridge.ts'
import type { RuntimeBackend } from '../../../shared/cdp/realm.ts'
import { isNativeRecord, optionalNativeField, requireNativeRecord } from './values.ts'
import { hostScriptKey } from './scripts.ts'

/** Host Runtime adapter preserving native V8 semantics behind common values. */
export class HostRuntimeBackend implements RuntimeBackend {
  private defaultContextId: number | undefined
  private readonly unsubscribe: () => void

  constructor(private readonly target: HostInspectorSession) {
    this.unsubscribe = target.subscribe((message) => { this.observeContext(message) })
  }

  async enable(): Promise<void> {
    await this.target.request('Runtime.enable', {})
  }

  async disable(): Promise<void> {
    await this.target.request('Runtime.disable', {})
    this.defaultContextId = undefined
  }

  async evaluate(request: Parameters<RuntimeBackend['evaluate']>[0]): ReturnType<RuntimeBackend['evaluate']> {
    return this.completion(await this.target.request('Runtime.evaluate', {
      expression: request.expression,
      ...nativeContext(request.context, 'contextId'),
      ...optionalNativeField('objectGroup', request.objectGroup),
      ...optionalNativeField('includeCommandLineAPI', request.includeCommandLineAPI),
      ...optionalNativeField('silent', request.silent),
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('userGesture', request.userGesture),
      ...optionalNativeField('awaitPromise', request.awaitPromise),
      ...optionalNativeField('disableBreaks', request.disableBreaks),
      ...optionalNativeField('replMode', request.replMode),
      ...optionalNativeField('allowUnsafeEvalBlockedByCSP', request.allowUnsafeEvalBlockedByCSP),
      ...optionalNativeField('throwOnSideEffect', request.throwOnSideEffect),
      ...optionalNativeField('serializationOptions', request.serializationOptions),
      ...optionalNativeField('timeout', request.timeoutMs),
    }))
  }

  async getProperties(request: Parameters<RuntimeBackend['getProperties']>[0]): ReturnType<RuntimeBackend['getProperties']> {
    const response = await this.target.request('Runtime.getProperties', {
      objectId: request.handle,
      ...optionalNativeField('ownProperties', request.ownProperties),
      ...optionalNativeField('accessorPropertiesOnly', request.accessorPropertiesOnly),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('nonIndexedPropertiesOnly', request.nonIndexedPropertiesOnly),
    })
    return this.properties(response)
  }

  async callFunction(request: Parameters<RuntimeBackend['callFunction']>[0]): ReturnType<RuntimeBackend['callFunction']> {
    const receiver = request.receiver
    const context = receiver === undefined
      ? nativeContext(request.context ?? defaultContext(this.defaultContextId), 'executionContextId')
      : undefined
    if (receiver === undefined && context === undefined) {
      throw new Error('Host Runtime default execution context is unavailable')
    }
    return this.completion(await this.target.request('Runtime.callFunctionOn', {
      functionDeclaration: request.functionDeclaration,
      ...(receiver === undefined ? context : { objectId: receiver }),
      ...(request.arguments === undefined ? {} : { arguments: request.arguments.map(toNativeArgument) }),
      ...optionalNativeField('objectGroup', request.objectGroup),
      ...optionalNativeField('silent', request.silent),
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
      ...optionalNativeField('userGesture', request.userGesture),
      ...optionalNativeField('awaitPromise', request.awaitPromise),
      ...optionalNativeField('throwOnSideEffect', request.throwOnSideEffect),
      ...optionalNativeField('serializationOptions', request.serializationOptions),
    }))
  }

  async awaitPromise(request: Parameters<RuntimeBackend['awaitPromise']>[0]): ReturnType<RuntimeBackend['awaitPromise']> {
    return this.completion(await this.target.request('Runtime.awaitPromise', {
      promiseObjectId: request.promise,
      ...optionalNativeField('returnByValue', request.returnByValue),
      ...optionalNativeField('generatePreview', request.generatePreview),
    }))
  }

  async globalLexicalScopeNames(context?: RuntimeExecutionContext): Promise<readonly string[]> {
    const response = await this.target.request('Runtime.globalLexicalScopeNames', {
      ...nativeContext(context ?? defaultContext(this.defaultContextId), 'executionContextId'),
    })
    if (!Array.isArray(response.names) || !response.names.every(name => typeof name === 'string')) {
      throw new Error('Host Runtime returned invalid lexical scope names')
    }
    return response.names
  }

  async releaseObject(handle: RuntimeBackendObjectHandle): Promise<void> {
    await this.target.request('Runtime.releaseObject', { objectId: handle })
  }

  async releaseObjectGroup(group: string): Promise<void> {
    await this.target.request('Runtime.releaseObjectGroup', { objectGroup: group })
  }

  /** Release the native-context observer owned by this backend. */
  close(): void {
    this.unsubscribe()
  }

  /**
   * Convert a native Runtime completion returned through another Node domain.
   * @param value - Native result and optional exception details.
   * @returns The realm-neutral completion.
   */
  async completion(value: Readonly<Record<string, unknown>>): Promise<RuntimeCompletion<RuntimeBackendObjectHandle>> {
    return {
      result: await this.remoteObject(value.result),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: await this.exceptionDetails(value.exceptionDetails) }),
    }
  }

  private async properties(value: Readonly<Record<string, unknown>>): Promise<RuntimeProperties<RuntimeBackendObjectHandle>> {
    if (!Array.isArray(value.result)) throw new Error('Host Runtime returned invalid properties')
    return {
      properties: await Promise.all(value.result.map(item => this.property(item))),
      ...(value.internalProperties === undefined
        ? {}
        : { internalProperties: await this.internalProperties(value.internalProperties) }),
      ...(value.privateProperties === undefined
        ? {}
        : { privateProperties: await this.privateProperties(value.privateProperties) }),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: await this.exceptionDetails(value.exceptionDetails) }),
    }
  }

  private async property(value: unknown): Promise<RuntimePropertyDescriptor<RuntimeBackendObjectHandle>> {
    const record = requireNativeRecord(value, 'Host Runtime property descriptor')
    if (typeof record.name !== 'string'
      || typeof record.configurable !== 'boolean'
      || typeof record.enumerable !== 'boolean') {
      throw new Error('Host Runtime returned invalid property descriptor')
    }
    return {
      ...record,
      name: record.name,
      configurable: record.configurable,
      enumerable: record.enumerable,
      ...(record.value === undefined ? {} : { value: await this.remoteObject(record.value) }),
      ...(record.get === undefined ? {} : { get: await this.remoteObject(record.get) }),
      ...(record.set === undefined ? {} : { set: await this.remoteObject(record.set) }),
      ...(record.symbol === undefined ? {} : { symbol: await this.remoteObject(record.symbol) }),
    }
  }

  private async internalProperties(value: unknown): Promise<RuntimeInternalPropertyDescriptor<RuntimeBackendObjectHandle>[]> {
    if (!Array.isArray(value)) throw new Error('Host Runtime returned invalid internal properties')
    return Promise.all(value.map(async (item) => {
      const record = requireNativeRecord(item, 'Host Runtime internal property')
      if (typeof record.name !== 'string') throw new Error('Host Runtime returned invalid internal property')
      return {
        name: record.name,
        ...(record.value === undefined ? {} : { value: await this.remoteObject(record.value) }),
      }
    }))
  }

  private async privateProperties(value: unknown): Promise<RuntimePrivatePropertyDescriptor<RuntimeBackendObjectHandle>[]> {
    if (!Array.isArray(value)) throw new Error('Host Runtime returned invalid private properties')
    return Promise.all(value.map(async (item) => {
      const record = requireNativeRecord(item, 'Host Runtime private property')
      if (typeof record.name !== 'string') throw new Error('Host Runtime returned invalid private property')
      return {
        name: record.name,
        ...(record.value === undefined ? {} : { value: await this.remoteObject(record.value) }),
        ...(record.get === undefined ? {} : { get: await this.remoteObject(record.get) }),
        ...(record.set === undefined ? {} : { set: await this.remoteObject(record.set) }),
      }
    }))
  }

  /**
   * Convert native exception details to the common Runtime model.
   * @param value - Native `Runtime.ExceptionDetails` fields.
   * @returns Exception details with normalized object references.
   */
  async exceptionDetails(value: unknown): Promise<RuntimeExceptionDetails<RuntimeBackendObjectHandle>> {
    const record = requireNativeRecord(value, 'Host Runtime exception details')
    if (typeof record.text !== 'string'
      || !Number.isSafeInteger(record.lineNumber)
      || !Number.isSafeInteger(record.columnNumber)) {
      throw new Error('Host Runtime returned invalid exception details')
    }
    return {
      ...record,
      text: record.text,
      lineNumber: record.lineNumber as number,
      columnNumber: record.columnNumber as number,
      ...(record.stackTrace === undefined ? {} : { stackTrace: this.stackTrace(record.stackTrace) }),
      ...(record.exception === undefined ? {} : { exception: await this.remoteObject(record.exception) }),
    }
  }

  /**
   * Convert one native V8 RemoteObject to the common Runtime model.
   * @param value - Native `Runtime.RemoteObject` fields.
   * @returns Descriptor, backend handle, and optional Cordis identity.
   */
  async remoteObject(value: unknown): Promise<RuntimeRemoteObject<RuntimeBackendObjectHandle>> {
    const record = requireNativeRecord(value, 'Host Runtime RemoteObject')
    if (typeof record.type !== 'string') throw new Error('Host Runtime returned an invalid RemoteObject')
    const descriptor = { ...record }
    Reflect.deleteProperty(descriptor, 'objectId')
    if (!isJsonValue(descriptor)) throw new Error('Host Runtime returned a non-JSON RemoteObject descriptor')
    const objectId = typeof record.objectId === 'string' ? record.objectId : undefined
    const semanticReference = objectId === undefined ? undefined : await this.identifyObject(objectId)
    return {
      descriptor: descriptor as unknown as RuntimeRemoteObjectDescriptor,
      ...(objectId === undefined ? {} : { object: { handle: backendHandle(objectId) } }),
      ...(semanticReference === undefined ? {} : { semanticReference }),
    }
  }

  /**
   * Convert a native stack trace while retaining native script identities.
   * @param value - Native `Runtime.StackTrace` fields.
   * @returns Realm-neutral stack frames.
   */
  stackTrace(value: unknown): RuntimeStackTrace {
    const record = requireNativeRecord(value, 'Host Runtime stack trace')
    if (!Array.isArray(record.callFrames)) throw new Error('Host Runtime returned an invalid stack trace')
    return {
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
      callFrames: record.callFrames.map((frame) => {
        const fields = requireNativeRecord(frame, 'Host Runtime call frame')
        if (typeof fields.functionName !== 'string'
          || typeof fields.url !== 'string'
          || !Number.isSafeInteger(fields.lineNumber)
          || !Number.isSafeInteger(fields.columnNumber)) {
          throw new Error('Host Runtime returned an invalid call frame')
        }
        return {
          functionName: fields.functionName,
          ...(typeof fields.scriptId === 'string'
            ? { scriptKey: hostScriptKey(fields.scriptId) }
            : {}),
          url: fields.url,
          lineNumber: fields.lineNumber as number,
          columnNumber: fields.columnNumber as number,
        }
      }),
      ...(record.parent === undefined ? {} : { parent: this.stackTrace(record.parent) }),
    }
  }

  private observeContext(message: HostInspectorNotification): void {
    if (message.method === 'Runtime.executionContextCreated') {
      const context = isNativeRecord(message.params?.context) ? message.params.context : undefined
      const auxData = isNativeRecord(context?.auxData) ? context.auxData : undefined
      if (context !== undefined && auxData?.isDefault === true && Number.isSafeInteger(context.id)) {
        this.defaultContextId = context.id as number
      }
      return
    }
    if (message.method !== 'Runtime.executionContextDestroyed') return
    if (message.params?.executionContextId === this.defaultContextId) this.defaultContextId = undefined
  }

  private async identifyObject(objectId: string): Promise<InspectorObjectReference | undefined> {
    try {
      const response = await this.target.request('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: IDENTIFY_REALM_OBJECT_FUNCTION,
        returnByValue: true,
        silent: true,
      })
      if (response.exceptionDetails !== undefined || !isNativeRecord(response.result)) return undefined
      return response.result.value === undefined
        ? undefined
        : parseInspectorObjectReference(response.result.value)
    } catch {
      // Semantic recognition is optional metadata; preserve the Runtime value on failure.
      return undefined
    }
  }
}

function defaultContext(contextId: number | undefined): RuntimeExecutionContext | undefined {
  return contextId === undefined ? undefined : { kind: 'numeric', id: contextId }
}

function nativeContext(
  context: RuntimeExecutionContext | undefined,
  numericKey: 'contextId' | 'executionContextId',
): Readonly<Record<string, number | string>> | undefined {
  if (context === undefined) return undefined
  return context.kind === 'numeric' ? { [numericKey]: context.id } : { uniqueContextId: context.id }
}

function toNativeArgument(value: RuntimeCallArgument<RuntimeBackendObjectHandle>): Readonly<Record<string, unknown>> {
  switch (value.kind) {
    case 'value': return { value: value.value }
    case 'unserializable': return { unserializableValue: value.value }
    case 'object': return { objectId: value.handle }
    case 'undefined': return {}
    default: return assertNever(value)
  }
}

function backendHandle(value: string): RuntimeBackendObjectHandle {
  return inspectorId<'RuntimeBackendObjectHandle'>(value, 'Runtime backend object handle')
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Runtime call argument: ${JSON.stringify(value)}`)
}
