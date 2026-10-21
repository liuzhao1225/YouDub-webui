/** Worker-owned lifecycle model for active Host and Client JavaScript realms. */

import type { InspectorSourceGeneration, InspectorSourceId } from '../../shared/bridge/ids.ts'
import type { InspectorRealmCapabilities } from '../../shared/cdp/capabilities.ts'
import type { InspectorRealmId } from '../../shared/cdp/ids.ts'
import type {
  ConsoleBackend,
  DebuggerBackend,
  NativeDomainBackend,
  RealmCapability,
  RuntimeBackend,
  SourceBackend,
} from '../../shared/cdp/realm.ts'

/** Stable description of one active realm generation. */
export interface InspectorRealmDescriptor {
  readonly realmId: InspectorRealmId
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly kind: 'host' | 'client'
  readonly label: string
}

/** Execution-context ownership for one realm. */
export type InspectorRealmContext =
  | { readonly kind: 'native' }
  | {
    readonly kind: 'synthetic'
    readonly id: number
    readonly uniqueId: string
    readonly origin: string
  }

/** Capabilities bound to one realm and one DevTools connection. */
export interface InspectorRealmSession {
  readonly descriptor: InspectorRealmDescriptor
  readonly context: InspectorRealmContext
  readonly runtime: RealmCapability<RuntimeBackend>
  readonly console: RealmCapability<ConsoleBackend>
  readonly sources: RealmCapability<SourceBackend>
  readonly debugger: RealmCapability<DebuggerBackend>
  readonly nativeDomains: RealmCapability<NativeDomainBackend>
  /** Release every connection-owned backend resource. */
  close(): void
}

/** Active realm that can create isolated state for each DevTools connection. */
export interface InspectorRealm {
  readonly descriptor: InspectorRealmDescriptor
  readonly context: InspectorRealmContext
  readonly capabilities: InspectorRealmCapabilities
  /** @returns Isolated backend state for one DevTools connection. */
  openSession(): InspectorRealmSession
}
