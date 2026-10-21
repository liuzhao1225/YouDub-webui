/** RuntimeBackend over the typed Worker-to-Client transport. */

import type {
  ClientCallArgument,
  ClientRuntimeCommand,
  ClientRuntimeResult,
} from '../../../shared/bridge/messages/runtime/index.ts'
import type { ClientRuntimeSessionId } from '../../../shared/bridge/ids.ts'
import type { RuntimeBackendObjectHandle } from '../../../shared/cdp/ids.ts'
import type { RuntimeCallArgument } from '../../../shared/cdp/index.ts'
import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { RuntimeBackend } from '../../../shared/cdp/realm.ts'
import {
  clientCompletion,
  clientException,
  clientHandle,
  clientInternalProperty,
  clientProperty,
} from './values.ts'
import type { ClientScriptIdentity } from './scripts.ts'

/** Adapts one connection-local Client Runtime session to the common backend API. */
export class ClientRuntimeBackend implements RuntimeBackend {
  private closed = false

  constructor(
    private readonly target: ClientRuntimeTarget,
    private readonly sessionId: ClientRuntimeSessionId,
    private readonly router: ClientRuntimeRouter,
    private readonly scriptIds: ClientScriptIdentity,
  ) {}

  enable(): Promise<void> {
    return Promise.resolve()
  }

  disable(): Promise<void> {
    this.router.closeTargetSession(this.target, this.sessionId)
    return Promise.resolve()
  }

  async evaluate(request: Parameters<RuntimeBackend['evaluate']>[0]): ReturnType<RuntimeBackend['evaluate']> {
    assertClientEvaluationOptions(request)
    const {
      context: _context,
      throwOnSideEffect: _throwOnSideEffect,
      serializationOptions: _serializationOptions,
      ...supported
    } = request
    return clientCompletion(
      expectResult(await this.request({ op: 'evaluate', ...supported }), 'evaluate'),
      scriptKey => this.scriptIds.toRuntime(scriptKey),
    )
  }

  async getProperties(request: Parameters<RuntimeBackend['getProperties']>[0]): ReturnType<RuntimeBackend['getProperties']> {
    const result = expectResult(await this.request({
      op: 'get-properties',
      ...request,
      handle: clientHandle(request.handle),
    }), 'get-properties')
    return {
      properties: result.properties.map(clientProperty),
      ...(result.internalProperties === undefined
        ? {}
        : { internalProperties: result.internalProperties.map(clientInternalProperty) }),
      ...(result.exceptionDetails === undefined
        ? {}
        : {
          exceptionDetails: clientException(
            result.exceptionDetails,
            scriptKey => this.scriptIds.toRuntime(scriptKey),
          ),
        }),
    }
  }

  async callFunction(request: Parameters<RuntimeBackend['callFunction']>[0]): ReturnType<RuntimeBackend['callFunction']> {
    assertClientCallOptions(request)
    const {
      receiver,
      context: _context,
      arguments: args,
      throwOnSideEffect: _throwOnSideEffect,
      serializationOptions: _serializationOptions,
      ...options
    } = request
    const command: Extract<ClientRuntimeCommand, { op: 'call-function' }> = {
      op: 'call-function',
      ...options,
      ...(receiver === undefined ? {} : { receiver: clientHandle(receiver) }),
      ...(args === undefined ? {} : { arguments: args.map(argumentToClient) }),
    }
    return clientCompletion(
      expectResult(await this.request(command), 'call-function'),
      scriptKey => this.scriptIds.toRuntime(scriptKey),
    )
  }

  async awaitPromise(request: Parameters<RuntimeBackend['awaitPromise']>[0]): ReturnType<RuntimeBackend['awaitPromise']> {
    return clientCompletion(
      expectResult(await this.request({
        op: 'await-promise',
        ...request,
        promise: clientHandle(request.promise),
      }), 'await-promise'),
      scriptKey => this.scriptIds.toRuntime(scriptKey),
    )
  }

  async globalLexicalScopeNames(context?: Parameters<RuntimeBackend['globalLexicalScopeNames']>[0]): Promise<readonly string[]> {
    if (context !== undefined) throw new Error('Client Runtime does not support native execution contexts')
    return expectResult(await this.request({ op: 'global-lexical-scope-names' }), 'global-lexical-scope-names').names
  }

  async releaseObject(handle: RuntimeBackendObjectHandle): Promise<void> {
    expectResult(await this.request({ op: 'release-object', handle: clientHandle(handle) }), 'release-object')
  }

  async releaseObjectGroup(group: string): Promise<void> {
    expectResult(await this.request({ op: 'release-object-group', objectGroup: group }), 'release-object-group')
  }

  /** Close this connection's session and reject further requests. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.router.closeTargetSession(this.target, this.sessionId)
  }

  private request(command: ClientRuntimeCommand): Promise<ClientRuntimeResult> {
    if (this.closed) return Promise.reject(new Error('Client realm session is closed'))
    return this.router.request(this.target, this.sessionId, command)
  }
}

function argumentToClient(value: RuntimeCallArgument<RuntimeBackendObjectHandle>): ClientCallArgument {
  return value.kind === 'object' ? { kind: 'object', handle: clientHandle(value.handle) } : value
}

function expectResult<Operation extends ClientRuntimeResult['op']>(
  result: ClientRuntimeResult,
  operation: Operation,
): Extract<ClientRuntimeResult, { op: Operation }> {
  if (result.op !== operation) throw new Error(`Client Runtime returned ${result.op} for ${operation}`)
  return result as Extract<ClientRuntimeResult, { op: Operation }>
}

function assertClientEvaluationOptions(request: Parameters<RuntimeBackend['evaluate']>[0]): void {
  if (request.context !== undefined) throw new Error('Client Runtime does not support native execution contexts')
  if (request.throwOnSideEffect === true) throw new Error('Client Runtime does not support throwOnSideEffect')
  if (request.serializationOptions !== undefined) throw new Error('Client Runtime does not support serializationOptions')
  if (request.disableBreaks === true) throw new Error('Client Runtime does not support disableBreaks')
  if (request.allowUnsafeEvalBlockedByCSP === true) {
    throw new Error('Client Runtime cannot bypass the page Content Security Policy')
  }
  if (request.timeoutMs !== undefined && request.awaitPromise !== true) {
    throw new Error('Client Runtime supports timeout only when awaitPromise is enabled')
  }
}

function assertClientCallOptions(request: Parameters<RuntimeBackend['callFunction']>[0]): void {
  if (request.context !== undefined) throw new Error('Client Runtime does not support native execution contexts')
  if (request.throwOnSideEffect === true) throw new Error('Client Runtime does not support throwOnSideEffect')
  if (request.serializationOptions !== undefined) throw new Error('Client Runtime does not support serializationOptions')
  if (request.userGesture === true) throw new Error('Client Runtime does not support userGesture')
}
