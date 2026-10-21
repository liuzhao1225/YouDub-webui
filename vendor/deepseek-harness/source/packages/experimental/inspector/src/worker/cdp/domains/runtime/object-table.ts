/** Per-CDP-connection routing and projection for every realm's Runtime objects. */

import type {
  RuntimeCompletion,
  RuntimeConsoleBackendEvent,
  RuntimeExceptionDetails,
  RuntimeInternalPropertyDescriptor,
  RuntimePrivatePropertyDescriptor,
  RuntimeProperties,
  RuntimePropertyDescriptor,
  RuntimeRemoteObject,
  RuntimeStackTrace,
} from '../../../../shared/cdp/index.ts'
import type { InspectorObjectReference } from '../../../../shared/cordis/object-reference.ts'
import type { RuntimeBackendObjectHandle } from '../../../../shared/cdp/ids.ts'
import type { InspectorRealmDescriptor, InspectorRealmSession } from '../../../inspection/realm.ts'
import { cdpStringId, type CdpRemoteObjectId, type InspectorConnectionId } from '../../ids.ts'

/** Object retained behind one connection-local CDP object id. */
export interface RuntimeObjectRoute {
  readonly realm: InspectorRealmSession
  readonly handle: RuntimeBackendObjectHandle
  readonly group: string | undefined
}

/** Semantic presentation applied when an object belongs to a projected node. */
export interface RuntimeObjectPresentation {
  readonly subtype: 'node'
  readonly className: string
  readonly description: string
}

/** Observer of newly exposed Runtime object ids. */
export type RuntimeObjectObserver = (
  objectId: CdpRemoteObjectId,
  realm: InspectorRealmDescriptor,
  reference: InspectorObjectReference,
  group: string | undefined,
) => RuntimeObjectPresentation | undefined

/** CDP Runtime payload derived from one realm completion. */
export interface CdpRuntimeCompletion {
  readonly result: Readonly<Record<string, unknown>>
  readonly exceptionDetails?: Readonly<Record<string, unknown>>
}

/** CDP Runtime payload derived from one realm's property descriptors. */
export interface CdpGetPropertiesResult {
  readonly result: readonly Readonly<Record<string, unknown>>[]
  readonly internalProperties?: readonly Readonly<Record<string, unknown>>[]
  readonly privateProperties?: readonly Readonly<Record<string, unknown>>[]
  readonly exceptionDetails?: Readonly<Record<string, unknown>>
}

/** One CDP notification projected from a realm Console event. */
export interface CdpRuntimeEvent {
  readonly method: 'Runtime.consoleAPICalled' | 'Runtime.exceptionThrown'
  readonly params: Readonly<Record<string, unknown>>
}

/** Maps every realm's backend handles to object ids scoped to one CDP connection. */
export class RuntimeObjectTable {
  private readonly routes = new Map<CdpRemoteObjectId, RuntimeObjectRoute>()
  private nextObjectId = 1
  private nextExceptionId = 1
  private observer: RuntimeObjectObserver | undefined

  constructor(private readonly connectionId: InspectorConnectionId) {}

  /**
   * Install Cordis object recognition after Runtime and DOM sessions are assembled.
   * @param observer - Callback mapping a semantic reference to node presentation.
   */
  setObserver(observer: RuntimeObjectObserver): void {
    this.observer = observer
  }

  /**
   * Resolve one connection-local object id.
   * @param objectId - CDP object id allocated by this table.
   * @returns Its realm and backend handle when current.
   */
  resolve(objectId: string): RuntimeObjectRoute | undefined {
    return this.routes.get(cdpStringId<'CdpRemoteObjectId'>(objectId, 'objectId'))
  }

  /**
   * Convert a realm completion to CDP fields.
   * @param realm - Realm session that produced the value.
   * @param value - Engine-independent completion.
   * @param group - Object group inherited by exposed handles.
   * @returns CDP Runtime completion fields.
   */
  completion(
    realm: InspectorRealmSession,
    value: RuntimeCompletion<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): CdpRuntimeCompletion {
    return {
      result: this.remote(realm, value.result, group),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: this.exception(realm, value.exceptionDetails, group) }),
    }
  }

  /**
   * Convert realm property descriptors to CDP fields.
   * @param realm - Realm session that owns returned object references.
   * @param value - Engine-independent property result.
   * @param group - Object group inherited from the inspected object.
   * @returns CDP Runtime property result fields.
   */
  properties(
    realm: InspectorRealmSession,
    value: RuntimeProperties<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): CdpGetPropertiesResult {
    return {
      result: value.properties.map(property => this.property(realm, property, group)),
      ...(value.internalProperties === undefined
        ? {}
        : { internalProperties: value.internalProperties.map(property => this.internalProperty(realm, property, group)) }),
      ...(value.privateProperties === undefined
        ? {}
        : { privateProperties: value.privateProperties.map(property => this.privateProperty(realm, property, group)) }),
      ...(value.exceptionDetails === undefined
        ? {}
        : { exceptionDetails: this.exception(realm, value.exceptionDetails, group) }),
    }
  }

  /**
   * Project one realm Console event to a CDP Runtime notification.
   * @param realm - Realm session that emitted the event.
   * @param value - Realm-neutral Console or exception event.
   * @returns CDP method and parameters.
   */
  consoleEvent(
    realm: InspectorRealmSession,
    value: RuntimeConsoleBackendEvent<RuntimeBackendObjectHandle>,
  ): CdpRuntimeEvent {
    if (value.type === 'console-api') {
      const contextId = value.event.contextId
        ?? (realm.context.kind === 'synthetic' ? realm.context.id : undefined)
      return {
        method: 'Runtime.consoleAPICalled',
        params: {
          type: value.event.type,
          args: value.event.arguments.map(argument => this.remote(realm, argument, 'console')),
          timestamp: value.event.timestamp,
          ...(contextId === undefined ? {} : { executionContextId: contextId }),
          ...(value.event.stackTrace === undefined ? {} : { stackTrace: cdpStackTrace(value.event.stackTrace) }),
        },
      }
    }
    const contextId = value.event.contextId
      ?? (realm.context.kind === 'synthetic' ? realm.context.id : undefined)
    return {
      method: 'Runtime.exceptionThrown',
      params: {
        timestamp: value.event.timestamp,
        exceptionDetails: {
          ...this.exception(realm, value.event.details, 'console'),
          ...(contextId === undefined ? {} : { executionContextId: contextId }),
        },
      },
    }
  }

  /**
   * List realm sessions retaining at least one object in a group.
   * @param group - DevTools object-group name.
   * @returns Distinct realm sessions that must receive the release.
   */
  realmsInGroup(group: string): InspectorRealmSession[] {
    const realms = new Set<InspectorRealmSession>()
    for (const route of this.routes.values()) {
      if (route.group === group) realms.add(route.realm)
    }
    return [...realms]
  }

  /**
   * Forget one externally visible object id.
   * @param objectId - Released CDP object id.
   */
  release(objectId: string): void {
    this.routes.delete(cdpStringId<'CdpRemoteObjectId'>(objectId, 'objectId'))
  }

  /**
   * Forget all ids retained under one object group.
   * @param group - Released object-group name.
   */
  releaseGroup(group: string): void {
    for (const [objectId, route] of this.routes) {
      if (route.group === group) this.routes.delete(objectId)
    }
  }

  /**
   * Forget every object owned by one closed realm session.
   * @param realm - Closed realm session.
   */
  releaseRealm(realm: InspectorRealmSession): void {
    for (const [objectId, route] of this.routes) {
      if (route.realm === realm) this.routes.delete(objectId)
    }
  }

  /** Forget every object exposed on this DevTools connection. */
  clear(): void {
    this.routes.clear()
  }

  /**
   * Project one common Runtime value and retain its backend handle for this connection.
   * @param realm - Realm session that owns the value.
   * @param value - Realm-neutral Runtime value.
   * @param group - Object group assigned to any exposed handle.
   * @returns CDP RemoteObject fields.
   */
  remote(
    realm: InspectorRealmSession,
    value: RuntimeRemoteObject<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    const objectId = value.object === undefined
      ? undefined
      : this.expose(realm, value.object.handle, group)
    const presentation = objectId === undefined || value.semanticReference === undefined
      ? undefined
      : this.observer?.(objectId, realm.descriptor, value.semanticReference, group)
    const descriptor = value.descriptor
    return {
      ...descriptor,
      ...(presentation?.subtype === undefined ? {} : { subtype: presentation.subtype }),
      ...(presentation?.className === undefined ? {} : { className: presentation.className }),
      ...(presentation?.description === undefined ? {} : { description: presentation.description }),
      ...(objectId === undefined ? {} : { objectId }),
    }
  }

  private property(
    realm: InspectorRealmSession,
    property: RuntimePropertyDescriptor<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      ...property,
      ...(property.value === undefined ? {} : { value: this.remote(realm, property.value, group) }),
      ...(property.get === undefined ? {} : { get: this.remote(realm, property.get, group) }),
      ...(property.set === undefined ? {} : { set: this.remote(realm, property.set, group) }),
      ...(property.symbol === undefined ? {} : { symbol: this.remote(realm, property.symbol, group) }),
    }
  }

  private internalProperty(
    realm: InspectorRealmSession,
    property: RuntimeInternalPropertyDescriptor<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      name: property.name,
      ...(property.value === undefined ? {} : { value: this.remote(realm, property.value, group) }),
    }
  }

  private privateProperty(
    realm: InspectorRealmSession,
    property: RuntimePrivatePropertyDescriptor<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      name: property.name,
      ...(property.value === undefined ? {} : { value: this.remote(realm, property.value, group) }),
      ...(property.get === undefined ? {} : { get: this.remote(realm, property.get, group) }),
      ...(property.set === undefined ? {} : { set: this.remote(realm, property.set, group) }),
    }
  }

  private exception(
    realm: InspectorRealmSession,
    details: RuntimeExceptionDetails<RuntimeBackendObjectHandle>,
    group: string | undefined,
  ): Readonly<Record<string, unknown>> {
    return {
      ...details,
      exceptionId: this.nextExceptionId++,
      ...(realm.context.kind === 'synthetic' ? { executionContextId: realm.context.id } : {}),
      ...(details.stackTrace === undefined ? {} : { stackTrace: cdpStackTrace(details.stackTrace) }),
      ...(details.exception === undefined ? {} : { exception: this.remote(realm, details.exception, group) }),
    }
  }

  private expose(
    realm: InspectorRealmSession,
    handle: RuntimeBackendObjectHandle,
    group: string | undefined,
  ): CdpRemoteObjectId {
    const objectId = cdpStringId<'CdpRemoteObjectId'>(
      `runtime:${this.connectionId}:${String(this.nextObjectId++)}`,
      'objectId',
    )
    this.routes.set(objectId, { realm, handle, group })
    return objectId
  }
}

function cdpStackTrace(stack: RuntimeStackTrace): Readonly<Record<string, unknown>> {
  return {
    ...(stack.description === undefined ? {} : { description: stack.description }),
    callFrames: stack.callFrames.map(frame => ({
      functionName: frame.functionName,
      scriptId: frame.scriptKey ?? '0',
      url: frame.url,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber,
    })),
    ...(stack.parent === undefined ? {} : { parent: cdpStackTrace(stack.parent) }),
  }
}
