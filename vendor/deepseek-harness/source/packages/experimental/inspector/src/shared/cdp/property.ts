/** Realm-neutral property descriptors returned by Runtime backends. */

import type { RuntimeRemoteObject } from './remote-object.ts'

/** One JavaScript property descriptor returned without invoking accessors. */
export interface RuntimePropertyDescriptor<Handle extends string> {
  readonly name: string
  readonly value?: RuntimeRemoteObject<Handle>
  readonly writable?: boolean
  readonly get?: RuntimeRemoteObject<Handle>
  readonly set?: RuntimeRemoteObject<Handle>
  readonly configurable: boolean
  readonly enumerable: boolean
  readonly wasThrown?: boolean
  readonly isOwn?: boolean
  readonly symbol?: RuntimeRemoteObject<Handle>
}

/** One engine-owned property such as `[[Prototype]]`. */
export interface RuntimeInternalPropertyDescriptor<Handle extends string> {
  readonly name: string
  readonly value?: RuntimeRemoteObject<Handle>
}

/** One engine private property exposed when a backend supports it. */
export interface RuntimePrivatePropertyDescriptor<Handle extends string> {
  readonly name: string
  readonly value?: RuntimeRemoteObject<Handle>
  readonly get?: RuntimeRemoteObject<Handle>
  readonly set?: RuntimeRemoteObject<Handle>
}
