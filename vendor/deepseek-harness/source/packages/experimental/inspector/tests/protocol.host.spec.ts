/** Worker and shared protocol behavior. */

import { describe, expect, it, vi } from 'vitest'
import { INSPECTOR_PROTOCOL_VERSION, parseSourceFrame, parseWorkerSourceFrame } from '../src/shared/bridge/messages/observation.ts'
import { InspectorSourceRegistry, type InspectorRecordConsumer, type SourceConnection } from '../src/worker/bridge/hub.ts'

describe('Inspector source protocol', () => {
  it('rebuilds a valid source frame and rejects non-JSON payloads', () => {
    const frame = parseSourceFrame({
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'generation-1',
      firstSequence: 1,
      droppedBefore: 0,
      records: [{ monotonicMs: 12, topic: 'probe', payload: { ok: true } }],
    }, 4)
    expect(frame.t).toBe('source/append')
    expect(() => parseSourceFrame({
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'generation-1',
      firstSequence: 1,
      droppedBefore: 0,
      records: [{ monotonicMs: 12, topic: 'probe', payload: { bad: undefined } }],
    }, 4)).toThrow('lossless JSON object')
  })

  it('isolates generations and reports sequence gaps', () => {
    const replace = vi.fn()
    const append = vi.fn()
    const close = vi.fn()
    const consumer: InspectorRecordConsumer = {
      topics: new Set(['probe']),
      replace,
      append,
      close,
    }
    const replies: unknown[] = []
    const send = vi.fn((frame: unknown) => { replies.push(frame) })
    const closeConnection = vi.fn()
    const connection: SourceConnection = {
      kind: 'host',
      send,
      close: closeConnection,
    }
    const registry = new InspectorSourceRegistry([consumer], 16_384, 4)
    registry.receive(connection, {
      v: 0,
      t: 'source/open',
      source: {
        sourceId: 'host-1',
        generation: 'g-1',
        kind: 'host',
        label: 'Host',
        timeOriginMs: 1_000,
        capabilities: [],
      },
      topics: ['probe'],
    })
    registry.receive(connection, {
      v: 0,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'g-1',
      firstSequence: 2,
      droppedBefore: 1,
      records: [{ monotonicMs: 1, topic: 'probe', payload: { value: 1 } }],
    })

    expect(append).toHaveBeenCalledOnce()
    expect(registry.describe()[0]).toMatchObject({ expectedSequence: 3, dropped: 1, topics: { probe: 1 } })

    registry.receive(connection, {
      v: 0,
      t: 'source/append',
      sourceId: 'host-1',
      generation: 'g-1',
      firstSequence: 5,
      droppedBefore: 0,
      records: [],
    })
    expect(replies.at(-1)).toMatchObject({ t: 'source/resnapshot', expectedSequence: 3 })
    expect(append).toHaveBeenCalledOnce()
  })

  it('closes only a malformed source connection', () => {
    const send = vi.fn()
    const closeConnection = vi.fn()
    const connection: SourceConnection = {
      kind: 'client',
      send,
      close: closeConnection,
    }
    const registry = new InspectorSourceRegistry([], 1_024, 2)
    registry.receive(connection, { v: 99, t: 'source/open' })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ t: 'source/rejected' }))
    expect(closeConnection).toHaveBeenCalledOnce()
  })

  it('decodes Runtime commands and rejects undeclared fields', () => {
    const request = parseWorkerSourceFrame({
      v: 0,
      t: 'client-runtime/request',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      command: {
        op: 'call-function',
        functionDeclaration: 'function () { return this.value }',
        receiver: 'object-1',
        arguments: [{ kind: 'unserializable', value: 'NaN' }],
        returnByValue: true,
      },
    })
    expect(request).toMatchObject({
      t: 'client-runtime/request',
      command: { op: 'call-function', receiver: 'object-1', returnByValue: true },
    })
    if (request.t !== 'client-runtime/request') throw new Error('unexpected frame type')
    expect(() => parseWorkerSourceFrame({
      ...request,
      command: { ...request.command, unversionedExtension: true },
    })).toThrow('unknown field')

    expect(parseWorkerSourceFrame({
      v: 0,
      t: 'client-runtime/response-acknowledged',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      requestId: 'request-1',
    })).toMatchObject({ t: 'client-runtime/response-acknowledged', requestId: 'request-1' })
  })

  it('rejects invalid RemoteObject representations', () => {
    expect(() => parseSourceFrame({
      v: 0,
      t: 'client-runtime/response',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      outcome: {
        ok: true,
        result: {
          op: 'evaluate',
          completion: {
            result: {
              descriptor: { type: 'number', value: 1 },
              object: { handle: 'object-1' },
            },
          },
        },
      },
    }, 4)).toThrow('invalid number RemoteObject representation')
  })

  it('decodes exact Client Console lifecycle and event frames', () => {
    expect(parseWorkerSourceFrame({
      v: 0,
      t: 'client-console/enable',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
    })).toMatchObject({ t: 'client-console/enable', sessionId: 'session-1' })

    const frame = parseSourceFrame({
      v: 0,
      t: 'client-console/event',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      event: {
        type: 'console-api',
        event: {
          type: 'log',
          arguments: [{
            descriptor: { type: 'object', className: 'Object', description: 'Object' },
            object: { handle: 'object-1' },
          }],
          timestamp: 12,
        },
      },
    }, 4)
    expect(frame).toMatchObject({
      t: 'client-console/event',
      sessionId: 'session-1',
      event: {
        type: 'console-api',
        event: { type: 'log', arguments: [{ object: { handle: 'object-1' } }] },
      },
    })

    expect(() => parseWorkerSourceFrame({
      v: 0,
      t: 'client-console/disable',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'session-1',
      extra: true,
    })).toThrow('unknown field')
  })

  it('decodes bounded Client source commands and responses', () => {
    expect(parseWorkerSourceFrame({
      v: 0,
      t: 'client-sources/request',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'source-session-1',
      requestId: 'source-request-1',
      command: {
        op: 'get-content-chunk',
        scriptKey: 'bundle',
        content: 'source',
        offset: 0,
        maxBytes: 1024,
      },
    })).toMatchObject({
      t: 'client-sources/request',
      command: { op: 'get-content-chunk', maxBytes: 1024 },
    })

    expect(parseSourceFrame({
      v: 0,
      t: 'client-sources/response',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'source-session-1',
      requestId: 'source-request-1',
      outcome: {
        ok: true,
        result: {
          op: 'get-content-chunk',
          scriptKey: 'bundle',
          content: 'source',
          available: true,
          offset: 0,
          nextOffset: 3,
          data: 'YWJj',
          eof: true,
        },
      },
    }, 4)).toMatchObject({
      t: 'client-sources/response',
      outcome: { ok: true, result: { data: 'YWJj', eof: true } },
    })

    expect(() => parseSourceFrame({
      v: 0,
      t: 'client-sources/response',
      sourceId: 'client-1',
      generation: 'g-1',
      sessionId: 'source-session-1',
      requestId: 'source-request-1',
      outcome: {
        ok: true,
        result: {
          op: 'get-content-chunk',
          scriptKey: 'bundle',
          content: 'source',
          available: true,
          offset: 0,
          nextOffset: 3,
          data: 'not base64',
          eof: true,
        },
      },
    }, 4)).toThrow('chunk data')
  })
})
