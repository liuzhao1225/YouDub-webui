/** Validation and projection of the shared Cordis tree representations. */

import { describe, expect, it } from 'vitest'
import { parseCordisRuntimeTree } from '../src/shared/cordis/model.ts'
import {
  identifyRealmObject,
  RealmObjectRegistry,
  realmObjectExpression,
} from '../src/shared/cordis/object-registry.ts'
import { parseInspectorObjectReference } from '../src/shared/cordis/object-reference.ts'
import { projectCordisRuntimeTree } from '../src/shared/cordis/projector.ts'
import { parseCordisTreeSnapshot, type CordisTreeSnapshot } from '../src/shared/cordis/snapshot.ts'

describe('Cordis runtime tree model', () => {
  it('parses connected and disconnected realms and rejects duplicate source identities', () => {
    const tree = {
      schemaVersion: 0,
      host: realm('host-1', 'host', { state: 'connected' }),
      clients: [realm('client-1', 'client', { state: 'disconnected', reason: 'offline' })],
    }
    expect(parseCordisRuntimeTree(tree)).toEqual(tree)
    expect(parseCordisRuntimeTree({ schemaVersion: 0, host: null, clients: [] }).host).toBeNull()
    expect(() => parseCordisRuntimeTree({
      ...tree,
      clients: [realm('host-1', 'client', { state: 'connected' })],
    })).toThrow('repeats a sourceId')
  })

  it.each([
    [{ schemaVersion: 1, host: null, clients: [] }, 'invalid Cordis runtime tree'],
    [{ schemaVersion: 0, host: null, clients: {} }, 'invalid Cordis runtime tree'],
    [{ schemaVersion: 0, host: realm('host-1', 'client', { state: 'connected' }), clients: [] }, 'invalid host Cordis runtime source'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { source: { sourceId: 'host-1', kind: 'host', label: '' } }), clients: [] }, 'invalid host Cordis runtime source'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { source: { sourceId: 'host-1', kind: 'host', label: 'x'.repeat(257) } }), clients: [] }, 'invalid host Cordis runtime source'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { revision: 0 }), clients: [] }, 'invalid Cordis runtime realm header'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'connected' }, { truncated: 'no' }), clients: [] }, 'invalid Cordis runtime realm header'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', null), clients: [] }, 'connection must be an object'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'disconnected', reason: 1 }), clients: [] }, 'invalid Cordis runtime connection'],
    [{ schemaVersion: 0, host: realm('host-1', 'host', { state: 'unknown' }), clients: [] }, 'invalid Cordis runtime connection'],
  ])('rejects malformed runtime tree headers %#', (value, message) => {
    expect(() => parseCordisRuntimeTree(value)).toThrow(message)
  })

  it('rejects malformed runtime nodes, duplicate Fiber ids, and excessive depth', () => {
    const withRoot = (root: unknown): unknown => ({
      schemaVersion: 0,
      host: realm('host-1', 'host', { state: 'connected' }, { root }),
      clients: [],
    })
    const fiber = (uid: unknown, children: unknown[] = [{ kind: 'context', children: [] }]): unknown => ({
      kind: 'fiber',
      uid,
      children,
    })
    const invalid = [
      [fiber(1), 'root must be a Context'],
      [null, 'known kind'],
      [{ kind: 'unknown', children: [] }, 'known kind'],
      [{ kind: 'context', children: {} }, 'children must be an array'],
      [{ kind: 'context', children: [fiber(0)] }, 'invalid Cordis runtime Fiber'],
      [{ kind: 'context', children: [fiber(1, [])] }, 'invalid Cordis runtime Fiber'],
      [{ kind: 'context', children: [fiber(1, [fiber(2)])] }, 'Fiber child must be a Context'],
      [{ kind: 'context', children: [fiber(1), fiber(1)] }, 'repeats a Fiber uid'],
    ] as const
    for (const [root, message] of invalid) expect(() => parseCordisRuntimeTree(withRoot(root))).toThrow(message)

    let deep: unknown = { kind: 'context', children: [] }
    for (let depth = 0; depth < 258; depth++) deep = { kind: 'context', children: [deep] }
    expect(() => parseCordisRuntimeTree(withRoot(deep))).toThrow('depth limit')
  })
})

describe('Cordis snapshot model', () => {
  it('parses a complete Context/Fiber tree and its object references', () => {
    const snapshot = routedSnapshot()
    expect(parseCordisTreeSnapshot(snapshot, 10)).toEqual(snapshot)
    expect(parseInspectorObjectReference({ registryId: 'registry-1', handle: 'context-1' })).toEqual({
      registryId: 'registry-1',
      handle: 'context-1',
    })
  })

  it.each([
    [{ ...routedSnapshot(), schemaVersion: 1 }, 'invalid Cordis tree header'],
    [{ ...routedSnapshot(), revision: 0 }, 'invalid Cordis tree header'],
    [{ ...routedSnapshot(), truncated: 'no' }, 'invalid Cordis tree header'],
    [{ ...routedSnapshot(), root: routedFiber(1, 'fiber-root', routedContext('fiber-child')) }, 'root must be a Context'],
    [{ ...routedSnapshot(), root: null }, 'known kind'],
    [{ ...routedSnapshot(), root: { kind: 'unknown', objectHandle: 'bad', children: [] } }, 'known kind'],
    [{ ...routedSnapshot(), root: { kind: 'context', objectHandle: 'bad', children: {} } }, 'children must be an array'],
    [{ ...routedSnapshot(), root: routedContext('same', [routedContext('same')]) }, 'repeats an object handle'],
    [{ ...routedSnapshot(), root: routedContext('root', [routedFiber(0, 'fiber', routedContext('child'))]) }, 'positive safe integer'],
    [{ ...routedSnapshot(), root: routedContext('root', [routedFiber(1, 'fiber', routedContext('child'), [])]) }, 'exactly one Context'],
    [{ ...routedSnapshot(), root: routedContext('root', [
      routedFiber(1, 'fiber-1', routedContext('child-1')),
      routedFiber(1, 'fiber-2', routedContext('child-2')),
    ]) }, 'repeats a Fiber uid'],
    [{ ...routedSnapshot(), root: routedContext('root', [
      routedFiber(1, 'fiber-1', routedContext('unused'), [routedFiber(2, 'fiber-2', routedContext('child'))]),
    ]) }, 'Fiber child must be a Context'],
  ])('rejects malformed routed snapshots %#', (value, message) => {
    expect(() => parseCordisTreeSnapshot(value, 10)).toThrow(message)
  })

  it('enforces node and depth limits', () => {
    expect(() => parseCordisTreeSnapshot(routedSnapshot(), 1)).toThrow('exceeds 1 nodes')
    let deep: unknown = routedContext('leaf')
    for (let depth = 0; depth < 258; depth++) deep = routedContext(`depth-${String(depth)}`, [deep])
    expect(() => parseCordisTreeSnapshot({ ...routedSnapshot(), root: deep }, 1_000)).toThrow('depth limit')
  })
})

describe('Cordis runtime projection', () => {
  it('removes routing fields from context-only and Fiber nodes in disconnected Client trees', () => {
    const projected = projectCordisRuntimeTree({
      host: null,
      clients: [{
        source: { sourceId: 'client-1', kind: 'client', label: 'Client' },
        connection: { state: 'disconnected', reason: 'offline' },
        snapshot: routedSnapshot(routedContext('root', [
          routedContext('nested'),
          routedFiber(1, 'fiber', routedContext('owned')),
        ])) as unknown as CordisTreeSnapshot,
      }],
    })

    expect(projected).toEqual({
      schemaVersion: 0,
      host: null,
      clients: [{
        source: { sourceId: 'client-1', kind: 'client', label: 'Client' },
        connection: { state: 'disconnected', reason: 'offline' },
        revision: 1,
        truncated: false,
        root: {
          kind: 'context',
          children: [
            { kind: 'context', children: [] },
            { kind: 'fiber', uid: 1, children: [{ kind: 'context', children: [] }] },
          ],
        },
      }],
    })
  })
})

describe('Cordis object registry', () => {
  it('retains stable identities, recognizes wrappers, and rolls generations atomically', () => {
    const registry = new RealmObjectRegistry()
    const value = {}
    const first = registry.begin()
    const reference = first.retain(value)
    expect(first.retain(value)).toEqual(reference)
    first.commit()
    first.commit()
    expect(registry.resolve(reference.handle)).toBe(value)
    expect(registry.identify(value)).toEqual(reference)
    expect(identifyRealmObject(value)).toEqual(reference)
    expect(globalThis.eval(realmObjectExpression(reference))).toBe(value)

    const wrapper = Object.create(value) as { then?: unknown }
    wrapper.then = undefined
    expect(registry.identify(wrapper)).toEqual(reference)
    let deepWrapper: object = value
    for (let depth = 0; depth < 10; depth++) {
      deepWrapper = Object.assign(Object.create(deepWrapper) as object, { then: undefined })
    }
    expect(registry.identify(deepWrapper)).toBeUndefined()
    expect(registry.identify(null)).toBeUndefined()
    expect(registry.identify(Object.create(value) as object)).toBeUndefined()
    expect(registry.identify(new Proxy({}, { ownKeys: () => { throw new Error('blocked') } }))).toBeUndefined()
    expect(identifyRealmObject({})).toBeUndefined()

    expect(() => first.retain({})).toThrow('already committed')
    expect(() => { first.release(reference.handle) }).toThrow('already committed')
    const second = registry.begin()
    second.release(reference.handle)
    second.commit()
    expect(registry.resolve(reference.handle)).toBeUndefined()
    registry.close()
    registry.close()
    expect(() => registry.begin()).toThrow('registry is disposed')
  })
})

function realm(
  sourceId: string,
  kind: 'host' | 'client',
  connection: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    source: { sourceId, kind, label: sourceId },
    connection,
    revision: 1,
    truncated: false,
    root: { kind: 'context', children: [{ kind: 'fiber', uid: 1, children: [{ kind: 'context', children: [] }] }] },
    ...overrides,
  }
}

function routedContext(objectHandle: string, children: unknown[] = []): Record<string, unknown> {
  return { kind: 'context', objectHandle, children }
}

function routedFiber(
  uid: unknown,
  objectHandle: string,
  context: unknown,
  children: unknown[] = [context],
): Record<string, unknown> {
  return { kind: 'fiber', uid, objectHandle, children }
}

function routedSnapshot(root: unknown = routedContext('context-1', [
  routedFiber(1, 'fiber-1', routedContext('context-2')),
])): Record<string, unknown> {
  return {
    schemaVersion: 0,
    revision: 1,
    objectRegistryId: 'registry-1',
    root,
    truncated: false,
  }
}
