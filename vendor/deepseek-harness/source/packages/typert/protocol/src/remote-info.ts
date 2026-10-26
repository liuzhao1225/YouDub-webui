/** Lazy assembly of generated Remote descriptors without loading their owning services. */

import type { InvocationDescriptor, TypertRemoteInfo, TypertRemoteSpec } from './types.ts'

/** Create a mountable contribution; indexing and codec construction remain lazy. */
export function createTypertRemoteInfo(spec: TypertRemoteSpec): TypertRemoteInfo {
  return new RemoteInfo(spec)
}

class RemoteInfo implements TypertRemoteInfo {
  private index?: readonly InvocationDescriptor[]

  constructor(private readonly spec: TypertRemoteSpec) {}

  get package(): string { return this.spec.package }
  get descriptors(): readonly InvocationDescriptor[] {
    return this.index ??= Object.entries(this.spec.methods).map(([endpoint, definition]) => {
      const separator = endpoint.indexOf('/')
      return {
        ...definition,
        id: `${this.spec.package}#${endpoint}`,
        namespace: endpoint.slice(0, separator),
        method: endpoint.slice(separator + 1),
        parameters: definition.parameters.map(parameter => ({ ...parameter, wire: parameter.wire ?? parameter.name })),
      }
    })
  }
}
