/** Host realm adapter backed by a connection-local Node inspector session. */

import { randomUUID } from 'node:crypto'
import { inspectorId } from '../../../shared/identity.ts'
import { HostConsoleBackend } from './console.ts'
import { HostDebuggerBackend } from './debugger.ts'
import { HostRuntimeBackend } from './runtime.ts'
import { HostSourceBackend } from './sources.ts'
import { HostInspectorSession } from './bridge.ts'
import type { InspectorRealm, InspectorRealmDescriptor, InspectorRealmSession } from '../../inspection/realm.ts'

const HOST_RUNTIME_OPERATIONS = [
  'evaluate',
  'get-properties',
  'call-function',
  'await-promise',
  'release-object',
  'release-object-group',
  'global-lexical-scope-names',
] as const

/** Host realm definition that opens one native V8 session per DevTools connection. */
export class HostInspectorRealm implements InspectorRealm {
  readonly descriptor: InspectorRealmDescriptor
  readonly context: InspectorRealm['context'] = { kind: 'native' }
  readonly capabilities: InspectorRealm['capabilities'] = {
    runtime: HOST_RUNTIME_OPERATIONS,
    console: ['events', 'exceptions', 'clear'],
    sources: ['catalog', 'content', 'source-map'],
    debugger: ['breakpoint', 'pause', 'resume', 'step', 'call-frame'],
  }

  constructor(private readonly label: string) {
    this.descriptor = {
      realmId: inspectorId<'InspectorRealmId'>(randomUUID(), 'realmId'),
      sourceId: inspectorId<'InspectorSourceId'>('host-runtime', 'sourceId'),
      generation: inspectorId<'InspectorSourceGeneration'>(randomUUID(), 'generation'),
      kind: 'host',
      label,
    }
  }

  /** Open a native Host inspector session for one DevTools connection. */
  openSession(): InspectorRealmSession {
    const target = new HostInspectorSession(this.label)
    const runtime = new HostRuntimeBackend(target)
    const console = new HostConsoleBackend(target, runtime)
    const sources = new HostSourceBackend(target)
    const debug = new HostDebuggerBackend(target, runtime)
    return {
      descriptor: this.descriptor,
      context: this.context,
      runtime: { state: 'supported', backend: runtime },
      console: { state: 'supported', backend: console },
      sources: { state: 'supported', backend: sources },
      debugger: { state: 'supported', backend: debug },
      nativeDomains: { state: 'supported', backend: target },
      close: () => {
        sources.close()
        debug.close()
        console.close()
        runtime.close()
        target.close()
      },
    }
  }
}
