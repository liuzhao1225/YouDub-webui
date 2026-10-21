/** Host-driven Cordis query integration. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCordisRuntimeTreeReader } from '../src/shared/cordis/reader.ts'
import {
  cordisRuntimeSourceId,
  type CordisRuntimeContext,
  type CordisRuntimeTree,
} from '../src/shared/cordis/model.ts'
import { startInspector, type InspectorHandle } from '../src/host/bridge/controller.ts'
import { publishCordisTree as publishHostCordisTree } from '../src/host/inspection/cordis.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import type { InspectorJsonValue } from '../src/shared/json.ts'
import { InspectorQueryConnection } from '../src/shared/bridge/rpc.ts'
import { parseInspectorQueryRequestFrame, parseInspectorQueryResponseFrame } from '../src/shared/bridge/messages/query/codec.ts'
import type { InspectorQueryRequestFrame, InspectorQueryResponseFrame } from '../src/shared/bridge/messages/query/frames.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'
import { createInspectorService } from '../src/shared/service.ts'
import { CordisTreeStore } from '../src/worker/inspection/cordis-store.ts'
import { InspectorQueryRouter } from '../src/worker/inspection/query-router.ts'
import { InspectorClientFixture } from './fixtures/client-source.host.ts'

describe('consumer-neutral Cordis tree', () => {
  it('projects a detached recursive tree without routing identifiers', () => {
    const store = new CordisTreeStore({ maxNodes: 10, maxDisconnectedTrees: 1 })
    const source = sourceDescriptor('host-1', 'generation-1', 'host')
    store.replace(source, [{
      sequence: 1,
      monotonicMs: 1,
      topic: 'cordis/tree',
      payload: asJson({
        schemaVersion: 0,
        revision: 3,
        objectRegistryId: 'registry-1',
        truncated: false,
        root: {
          kind: 'context',
          objectHandle: 'context-1',
          children: [{
            kind: 'fiber',
            uid: 12,
            objectHandle: 'fiber-1',
            children: [{ kind: 'context', objectHandle: 'context-2', children: [] }],
          }],
        },
      }),
    }])

    const tree = store.readTree()
    expect(tree).toEqual({
      schemaVersion: 0,
      host: {
        source: { sourceId: 'host-1', kind: 'host', label: 'host-1' },
        connection: { state: 'connected' },
        revision: 3,
        truncated: false,
        root: {
          kind: 'context',
          children: [{ kind: 'fiber', uid: 12, children: [{ kind: 'context', children: [] }] }],
        },
      },
      clients: [],
    })
    expect(tree.host?.root).not.toBe(store.tree().host?.snapshot.root)
    expect(forbiddenKeys(tree)).toEqual([])

    store.close(source, 'transport closed')
    expect(store.readTree().host?.connection).toEqual({ state: 'disconnected', reason: 'transport closed' })

    const reconnected = sourceDescriptor('host-1', 'generation-2', 'host')
    store.replace(reconnected, [{
      sequence: 1,
      monotonicMs: 2,
      topic: 'cordis/tree',
      payload: asJson({
        schemaVersion: 0,
        revision: 4,
        objectRegistryId: 'registry-2',
        truncated: false,
        root: { kind: 'context', objectHandle: 'context-3', children: [] },
      }),
    }])
    expect(store.readTree().host).toMatchObject({
      connection: { state: 'connected' },
      revision: 4,
      root: { kind: 'context', children: [] },
    })
    expect(forbiddenKeys(store.readTree())).toEqual([])
  })
})

describe('Inspector query protocol', () => {
  afterEach(() => { vi.useRealTimers() })

  it('uses exact request and response codecs', () => {
    const hiddenTree = runtimeTree()
    if (hiddenTree.host === null) throw new Error('test tree requires a Host realm')
    expect(parseInspectorQueryRequestFrame({
      v: 0,
      t: 'query/request',
      sourceId: 'host-1',
      generation: 'generation-1',
      requestId: 'query-1',
      query: { op: 'cordis-tree/get' },
    })).toMatchObject({ query: { op: 'cordis-tree/get' } })
    expect(() => parseInspectorQueryRequestFrame({
      v: 0,
      t: 'query/request',
      sourceId: 'host-1',
      generation: 'generation-1',
      requestId: 'query-1',
      query: { op: 'cordis-tree/get', extension: true },
    })).toThrow('unknown field')
    expect(() => parseInspectorQueryResponseFrame({
      ...successResponse('query-1', runtimeTree()),
      outcome: {
        ok: true,
        result: {
          op: 'cordis-tree/get',
          tree: {
            ...hiddenTree,
            host: {
              ...hiddenTree.host,
              root: { kind: 'context', objectHandle: 'private', children: [] },
            },
          },
        },
      },
    })).toThrow('unknown field')
  })

  it('correlates results and clears stale, malformed, timed-out, and closed requests', async () => {
    const sent: InspectorQueryRequestFrame[] = []
    const connection = new InspectorQueryConnection({ timeoutMs: 20, maxFrameBytes: 16_384 })
    connection.connect(sourceId('host-1'), generation('generation-1'), {
      send: (frame) => { sent.push(frame) },
    })

    const first = connection.request({ op: 'cordis-tree/get' })
    const firstFrame = sent.at(-1)!
    expect(connection.receive(successResponse(firstFrame.requestId, runtimeTree()))).toBe(true)
    await expect(first).resolves.toEqual({ op: 'cordis-tree/get', tree: runtimeTree() })

    const stale = connection.request({ op: 'cordis-tree/get' })
    const staleFrame = sent.at(-1)!
    expect(connection.receive({
      ...successResponse(staleFrame.requestId, runtimeTree()),
      generation: generation('generation-old'),
    })).toBe(true)
    await expect(stale).rejects.toThrow('source generation does not match')

    const malformed = connection.request({ op: 'cordis-tree/get' })
    const malformedFrame = sent.at(-1)!
    const malformedRejection = expect(malformed).rejects.toThrow('Invalid Inspector query response')
    expect(() => connection.receive({
      ...successResponse(malformedFrame.requestId, runtimeTree()),
      extension: true,
    })).toThrow('unknown field')
    await malformedRejection

    connection.connect(sourceId('host-1'), generation('generation-2'), {
      send: (frame) => { sent.push(frame) },
    })
    vi.useFakeTimers()
    const timedOut = connection.request({ op: 'cordis-tree/get' })
    const timeoutRejection = expect(timedOut).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(21)
    await timeoutRejection
    vi.useRealTimers()

    const closed = connection.request({ op: 'cordis-tree/get' })
    connection.close()
    await expect(closed).rejects.toThrow('closed')
  })

  it('rejects malformed, stale, and oversized Worker requests with bounded outcomes', async () => {
    const responses: InspectorQueryResponseFrame[] = []
    const close = vi.fn()
    const largeTree = runtimeTree({
      kind: 'context',
      children: Array.from({ length: 100 }, () => ({ kind: 'context', children: [] } as const)),
    })
    const router = new InspectorQueryRouter(createCordisRuntimeTreeReader(() => largeTree), 512)
    const peer = router.open({ send: (frame) => { responses.push(frame) }, close })
    peer.accept(sourceId('host-1'), generation('generation-1'))

    expect(peer.receive(requestFrame('query-stale', 'generation-old'))).toBe(true)
    expect(responses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'stale-source' } })

    expect(peer.receive({ ...requestFrame('query-malformed'), extension: true })).toBe(true)
    expect(responses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'invalid-request' } })

    expect(peer.receive(requestFrame('query-large'))).toBe(true)
    await vi.waitFor(() => {
      expect(responses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'result-too-large' } })
    })
    expect(close).not.toHaveBeenCalled()

    const requester = new InspectorQueryConnection({ timeoutMs: 100, maxFrameBytes: 512 })
    const pairedPeer = router.open({
      send: (frame) => { requester.receive(frame) },
      close: vi.fn(),
    })
    pairedPeer.accept(sourceId('client-2'), generation('generation-1'))
    requester.connect(sourceId('client-2'), generation('generation-1'), {
      send: (frame) => { pairedPeer.receive(frame) },
    })
    await expect(requester.request({ op: 'cordis-tree/get' })).rejects.toMatchObject({ code: 'result-too-large' })
    requester.close()
  })

  it('revokes an older carrier when the same source opens a new generation', () => {
    const firstResponses: InspectorQueryResponseFrame[] = []
    const router = new InspectorQueryRouter(createCordisRuntimeTreeReader(() => runtimeTree()), 16_384)
    const first = router.open({ send: (frame) => { firstResponses.push(frame) }, close: vi.fn() })
    const second = router.open({ send: vi.fn(), close: vi.fn() })
    first.accept(sourceId('client-1'), generation('generation-1'))
    second.accept(sourceId('client-1'), generation('generation-2'))

    expect(first.receive({
      ...requestFrame('query-old', 'generation-1'),
      sourceId: sourceId('client-1'),
    })).toBe(true)
    expect(firstResponses.at(-1)?.outcome).toMatchObject({ ok: false, error: { code: 'stale-source' } })
  })
})

describe('Cordis query service integration', () => {
  let inspector: InspectorHandle | undefined
  let clientSource: InspectorClientFixture | undefined
  const observers: Array<() => void> = []

  afterEach(async () => {
    for (const dispose of observers.splice(0).reverse()) dispose()
    await clientSource?.close()
    clientSource = undefined
    await inspector?.close()
    inspector = undefined
  })

  it('returns the same Worker snapshot to Host and Client services without a CDP connection', async () => {
    inspector = await startInspector({
      port: 0,
      captureFetch: false,
      queryTimeoutMs: 1_000,
      maxCordisNodes: 100,
    })
    const hostContext = new Context()
    observers.push(publishHostCordisTree(hostContext, inspector.source, { maxNodes: 100, maxBytes: 64 * 1_024 }))
    const hostService = createInspectorService(inspector.source)

    clientSource = await InspectorClientFixture.start(inspector.endpoint.client, { label: 'Query Client' })

    await vi.waitFor(async () => {
      const [hostTree, clientTree] = await Promise.all([
        hostService.cordis.getTree(),
        clientSource!.getCordisTree(),
      ])
      expect(hostTree).toEqual(clientTree)
      expect(hostTree.host?.source.kind).toBe('host')
      expect(hostTree.clients).toHaveLength(1)
      expect(forbiddenKeys(hostTree)).toEqual([])
    })

    await clientSource.close()
    clientSource = undefined
    await vi.waitFor(async () => {
      const tree = await hostService.cordis.getTree()
      expect(tree.clients[0]?.connection.state).toBe('disconnected')
    })
  })
})

function sourceDescriptor(
  id: string,
  sourceGeneration: string,
  kind: InspectorSourceDescriptor['kind'],
): InspectorSourceDescriptor {
  return {
    sourceId: sourceId(id),
    generation: generation(sourceGeneration),
    kind,
    label: id,
    timeOriginMs: 0,
    capabilities: [],
  }
}

function sourceId(value: string): InspectorSourceDescriptor['sourceId'] {
  return inspectorId<'InspectorSourceId'>(value, 'sourceId')
}

function generation(value: string): InspectorSourceDescriptor['generation'] {
  return inspectorId<'InspectorSourceGeneration'>(value, 'generation')
}

function runtimeTree(root: CordisRuntimeContext = { kind: 'context', children: [] }): CordisRuntimeTree {
  return {
    schemaVersion: 0,
    host: {
      source: { sourceId: cordisRuntimeSourceId('host-1'), kind: 'host', label: 'Host' },
      connection: { state: 'connected' },
      revision: 1,
      truncated: false,
      root,
    },
    clients: [],
  }
}

function requestFrame(requestId: string, sourceGeneration = 'generation-1'): InspectorQueryRequestFrame {
  return {
    v: 0,
    t: 'query/request',
    sourceId: sourceId('host-1'),
    generation: generation(sourceGeneration),
    requestId: inspectorId<'InspectorQueryRequestId'>(requestId, 'requestId'),
    query: { op: 'cordis-tree/get' },
  }
}

function successResponse(requestId: string, tree: CordisRuntimeTree): InspectorQueryResponseFrame {
  return {
    v: 0,
    t: 'query/response',
    sourceId: sourceId('host-1'),
    generation: generation('generation-1'),
    requestId: inspectorId<'InspectorQueryRequestId'>(requestId, 'requestId'),
    outcome: { ok: true, result: { op: 'cordis-tree/get', tree } },
  }
}

function forbiddenKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(forbiddenKeys)
  const forbidden = new Set([
    'objectHandle', 'objectRegistryId', 'registryId', 'generation', 'executionContextId',
    'scriptId', 'nodeId', 'backendNodeId', 'objectId', 'remoteObjectId',
  ])
  return Reflect.ownKeys(value).flatMap((key) => {
    if (typeof key !== 'string') return []
    return [...(forbidden.has(key) ? [key] : []), ...forbiddenKeys(Reflect.get(value, key))]
  })
}

function asJson(value: object): InspectorJsonValue {
  return value as unknown as InspectorJsonValue
}
