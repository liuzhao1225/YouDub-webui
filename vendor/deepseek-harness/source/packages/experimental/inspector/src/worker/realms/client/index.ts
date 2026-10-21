/** Client realm definition assembled from independent Runtime, Console, and Source backends. */

import { randomUUID } from 'node:crypto'
import { inspectorId } from '../../../shared/identity.ts'
import { ClientConsoleBackend } from './console.ts'
import { ClientRuntimeBackend } from './runtime.ts'
import { ClientSourceBackend } from './sources.ts'
import { ClientScriptIdentity } from './scripts.ts'
import type { ClientRuntimeRouter, ClientRuntimeTarget } from '../../bridge/runtime-rpc.ts'
import type { ClientSourceRouter } from '../../bridge/source-rpc.ts'
import type { InspectorRealm, InspectorRealmDescriptor, InspectorRealmSession } from '../../inspection/realm.ts'
import { createClientRealmBridge, type ClientRealmBridge } from './bridge.ts'
import { clientDebuggerCapability } from './debugger.ts'

const CLIENT_RUNTIME_OPERATIONS = [
  'evaluate',
  'get-properties',
  'call-function',
  'await-promise',
  'release-object',
  'release-object-group',
  'global-lexical-scope-names',
] as const

/** Active Client realm exposed through the common Worker realm model. */
export class ClientInspectorRealm implements InspectorRealm {
  readonly descriptor: InspectorRealmDescriptor
  readonly context: InspectorRealm['context']
  readonly capabilities: InspectorRealm['capabilities']
  private readonly scriptIds: ClientScriptIdentity
  private readonly bridge: ClientRealmBridge

  constructor(
    target: ClientRuntimeTarget,
    runtimeRouter: ClientRuntimeRouter,
    sourceRouter: ClientSourceRouter,
  ) {
    this.bridge = createClientRealmBridge(target, runtimeRouter, sourceRouter)
    this.descriptor = {
      realmId: inspectorId<'InspectorRealmId'>(randomUUID(), 'realmId'),
      sourceId: target.source.sourceId,
      generation: target.source.generation,
      kind: 'client',
      label: target.source.label,
    }
    this.context = {
      kind: 'synthetic',
      id: target.contextId,
      uniqueId: target.uniqueContextId,
      origin: target.capability.origin,
    }
    this.scriptIds = new ClientScriptIdentity(target.contextId)
    this.capabilities = {
      runtime: CLIENT_RUNTIME_OPERATIONS,
      console: supports(target, 'client-console') ? ['events', 'exceptions', 'clear'] : [],
      sources: supports(target, 'client-sources') ? ['catalog', 'content', 'source-map'] : [],
      debugger: [],
    }
  }

  /** Active source generation represented by this realm. */
  get target(): ClientRuntimeTarget {
    return this.bridge.target
  }

  /** Open one isolated set of Client backends for a DevTools connection. */
  openSession(): InspectorRealmSession {
    const runtimeSessionId = inspectorId<'ClientRuntimeSessionId'>(randomUUID(), 'runtimeSessionId')
    const runtime = new ClientRuntimeBackend(this.target, runtimeSessionId, this.bridge.runtime, this.scriptIds)
    const console = supports(this.target, 'client-console')
      ? new ClientConsoleBackend(this.target, runtimeSessionId, this.bridge.runtime, this.scriptIds)
      : undefined
    const sources = supports(this.target, 'client-sources')
      ? new ClientSourceBackend(
        this.target,
        inspectorId<'ClientSourceSessionId'>(randomUUID(), 'sourceSessionId'),
        this.bridge.sources,
        this.scriptIds,
      )
      : undefined
    return {
      descriptor: this.descriptor,
      context: this.context,
      runtime: { state: 'supported', backend: runtime },
      console: console === undefined
        ? { state: 'unsupported', reason: 'Client source does not provide Console events' }
        : { state: 'supported', backend: console },
      sources: sources === undefined
        ? { state: 'unsupported', reason: 'Client source does not provide a script catalog' }
        : { state: 'supported', backend: sources },
      debugger: clientDebuggerCapability(),
      nativeDomains: { state: 'unsupported', reason: 'Client realm has no native CDP transport' },
      close: () => {
        console?.close()
        sources?.close()
        runtime.close()
      },
    }
  }
}

function supports(target: ClientRuntimeTarget, capability: 'client-console' | 'client-sources'): boolean {
  return target.source.capabilities.some(candidate => candidate.type === capability)
}
