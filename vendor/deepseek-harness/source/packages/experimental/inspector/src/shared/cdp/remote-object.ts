/** Realm-neutral JavaScript value descriptions used by Inspector backends. */

import type { InspectorObjectReference } from '../cordis/object-reference.ts'
import type { InspectorJsonValue } from '../json.ts'

/** Runtime value kinds represented by CDP `Runtime.RemoteObject`. */
export type RuntimeRemoteObjectType =
  | 'object'
  | 'function'
  | 'undefined'
  | 'string'
  | 'number'
  | 'boolean'
  | 'symbol'
  | 'bigint'

/** Runtime object subtype hints understood by Chrome DevTools. */
export type RuntimeRemoteObjectSubtype =
  | 'array'
  | 'null'
  | 'node'
  | 'regexp'
  | 'date'
  | 'map'
  | 'set'
  | 'weakmap'
  | 'weakset'
  | 'iterator'
  | 'generator'
  | 'error'
  | 'proxy'
  | 'promise'
  | 'typedarray'
  | 'arraybuffer'
  | 'dataview'
  | 'webassemblymemory'
  | 'wasmvalue'

/** Shallow property rendered inline by DevTools. */
export interface RuntimePropertyPreview {
  readonly name: string
  readonly type: RuntimeRemoteObjectType | 'accessor'
  readonly value?: string
  readonly valuePreview?: RuntimeObjectPreview
  readonly subtype?: RuntimeRemoteObjectSubtype
}

/** Shallow object rendering that never carries a live-object reference. */
export interface RuntimeObjectPreview {
  readonly type: RuntimeRemoteObjectType
  readonly subtype?: RuntimeRemoteObjectSubtype
  readonly description?: string
  readonly overflow: boolean
  readonly properties: readonly RuntimePropertyPreview[]
}

/** Engine-independent description of one JavaScript value. */
export interface RuntimeRemoteObjectDescriptor {
  readonly type: RuntimeRemoteObjectType
  readonly subtype?: RuntimeRemoteObjectSubtype
  readonly className?: string
  readonly value?: InspectorJsonValue
  readonly unserializableValue?: string
  readonly description?: string
  readonly preview?: RuntimeObjectPreview
}

/** Backend-owned reference to a retained object in one realm session. */
export interface RuntimeBackendObjectReference<Handle extends string> {
  readonly handle: Handle
}

/** Realm-neutral value plus optional backend and Cordis identities. */
export interface RuntimeRemoteObject<Handle extends string> {
  readonly descriptor: RuntimeRemoteObjectDescriptor
  readonly object?: RuntimeBackendObjectReference<Handle>
  readonly semanticReference?: InspectorObjectReference
}
