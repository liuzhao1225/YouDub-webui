/** Worker-side Network projection behavior. */

import { describe, expect, it, vi } from 'vitest'
import { NetworkDomain, type NetworkSink } from '../src/worker/cdp/domains/network/session.ts'
import { NetworkStore } from '../src/worker/inspection/network-store.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'
import type { IngestedInspectorRecord } from '../src/worker/bridge/hub.ts'
import type { InspectorJsonValue } from '../src/shared/json.ts'

const source: InspectorSourceDescriptor = {
  sourceId: inspectorId<'InspectorSourceId'>('host-network', 'sourceId'),
  generation: inspectorId<'InspectorSourceGeneration'>('network-generation', 'generation'),
  kind: 'host',
  label: 'Host',
  timeOriginMs: performance.timeOrigin,
  capabilities: [],
}

describe('Inspector Network domain', () => {
  it('bounds incomplete bodies and marks the retained prefix truncated', () => {
    const sendEvent = vi.fn()
    const sink: NetworkSink = { sendEvent }
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 4 })
    const network = new NetworkDomain(store)
    network.enable(sink)
    store.append(source, requestRecords('first', 'abcdef'))

    const response = network.handle('Network.getResponseBody', { requestId: requestId('first') }, sink)
    expect(response).toEqual({
      body: Buffer.from('abcd').toString('base64'),
      base64Encoded: true,
      dshInspectorTruncated: true,
    })
    const dataEvent = sendEvent.mock.calls.find(call => call[0] === 'Network.dataReceived')
    expect(dataEvent?.[1]).toMatchObject({ dataLength: 6, encodedDataLength: 6 })
    expect(dataEvent?.[1]).not.toHaveProperty('data')
  })

  it('evicts completed requests before retaining a later body', () => {
    const sink: NetworkSink = { sendEvent: vi.fn() }
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 4 })
    const network = new NetworkDomain(store)
    store.append(source, requestRecords('first', 'aaaa'))
    store.append(source, requestRecords('second', 'bbbb'))

    expect(() => network.handle('Network.getResponseBody', { requestId: requestId('first') }, sink)).toThrow(
      'No resource with given identifier',
    )
    expect(network.handle('Network.getResponseBody', { requestId: requestId('second') }, sink)).toEqual({
      body: Buffer.from('bbbb').toString('base64'),
      base64Encoded: true,
      dshInspectorTruncated: false,
    })
  })

  it('streams later response chunks only to CDP sessions that opted in', () => {
    const firstSend = vi.fn()
    const secondSend = vi.fn()
    const first: NetworkSink = { sendEvent: firstSend }
    const second: NetworkSink = { sendEvent: secondSend }
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    const network = new NetworkDomain(store)
    network.enable(first)
    network.enable(second)
    const records = requestRecords('stream', 'data: first\n\n')
    store.append(source, records.slice(0, 2))

    expect(network.handle('Network.streamResourceContent', { requestId: requestId('stream') }, first)).toEqual({
      bufferedData: '',
    })
    store.append(source, records.slice(2, 3))

    const firstData = firstSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')
    const secondData = secondSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')
    expect(firstData?.[1]).toMatchObject({ data: Buffer.from('data: first\n\n').toString('base64') })
    expect(secondData?.[1]).not.toHaveProperty('data')
    expect(network.handle('Network.streamResourceContent', { requestId: requestId('stream') }, second)).toEqual({
      bufferedData: Buffer.from('data: first\n\n').toString('base64'),
    })

    const later = Buffer.from('data: second\n\n').toString('base64')
    store.append(source, [{
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: 'stream', data: later },
    }])
    expect(firstSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')?.[1]).toMatchObject({ data: later })
    expect(secondSend.mock.calls.findLast(call => call[0] === 'Network.dataReceived')?.[1]).toMatchObject({ data: later })
  })

  it('projects and replays parsed Server-Sent Events through the CDP EventSource path', () => {
    const liveSend = vi.fn()
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    const network = new NetworkDomain(store)
    network.enable({ sendEvent: liveSend })
    store.append(source, eventStreamRecords('events'))

    expect(liveSend).toHaveBeenNthCalledWith(1, 'Network.requestWillBeSent', expect.objectContaining({
      type: 'EventSource',
    }))
    expect(liveSend).toHaveBeenCalledWith('Network.responseReceived', expect.objectContaining({
      type: 'EventSource',
    }))
    expect(liveSend.mock.calls
      .filter(call => call[0] === 'Network.eventSourceMessageReceived')
      .map(call => call[1] as unknown))
      .toEqual([
        expect.objectContaining({ eventName: 'message', eventId: '1', data: 'first' }),
        expect.objectContaining({ eventName: 'update', eventId: '2', data: 'second\nline' }),
      ])
    expect(liveSend.mock.calls.map(call => String(call[0]))).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.eventSourceMessageReceived',
      'Network.dataReceived',
      'Network.eventSourceMessageReceived',
      'Network.dataReceived',
      'Network.loadingFinished',
    ])

    const replay = vi.fn()
    network.enable({ sendEvent: replay })
    expect(replay).toHaveBeenNthCalledWith(1, 'Network.requestWillBeSent', expect.objectContaining({
      type: 'EventSource',
    }))
    expect(replay.mock.calls
      .filter(call => call[0] === 'Network.eventSourceMessageReceived')
      .map(call => call[1] as unknown))
      .toEqual([
        expect.objectContaining({ timestamp: 0.003, eventName: 'message', eventId: '1', data: 'first' }),
        expect.objectContaining({ timestamp: 0.004, eventName: 'update', eventId: '2', data: 'second\nline' }),
      ])
    expect(replay.mock.calls.map(call => String(call[0]))).toEqual([
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.eventSourceMessageReceived',
      'Network.eventSourceMessageReceived',
      'Network.loadingFinished',
    ])
  })

  it('bounds active request metadata and does not retain per-chunk events for replay', () => {
    const firstSend = vi.fn()
    const store = new NetworkStore({ maxRetainedRequests: 1, maxJournalBytes: 1_024 })
    const network = new NetworkDomain(store)
    network.enable({ sendEvent: firstSend })
    store.append(source, requestRecords('active-first', 'first').slice(0, 1))
    store.append(source, requestRecords('active-second', 'second').slice(0, 1))

    expect(firstSend).toHaveBeenCalledWith('Network.loadingFailed', expect.objectContaining({
      requestId: requestId('active-first'),
      canceled: true,
    }))
    expect(() => network.handle(
      'Network.getRequestPostData',
      { requestId: requestId('active-first') },
      { sendEvent: vi.fn() },
    )).toThrow('No resource with given identifier')
    expect(() => { store.append(source, requestRecords('active-first', 'first').slice(1)) }).not.toThrow()

    store.append(source, requestRecords('active-second', 'second').slice(1))
    const replay = vi.fn()
    network.enable({ sendEvent: replay })
    expect(replay.mock.calls.some(call => call[0] === 'Network.dataReceived')).toBe(false)
    expect(replay).toHaveBeenCalledTimes(3)
    expect(replay).toHaveBeenNthCalledWith(1, 'Network.requestWillBeSent', expect.any(Object))
    expect(replay).toHaveBeenNthCalledWith(2, 'Network.responseReceived', expect.any(Object))
    expect(replay).toHaveBeenNthCalledWith(3, 'Network.loadingFinished', expect.any(Object))
  })

  it('finishes a response whose observer clone ended with a capture error', () => {
    const sendEvent = vi.fn()
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    const network = new NetworkDomain(store)
    network.enable({ sendEvent })
    const records = requestRecords('capture-error', 'partial')
    store.append(source, [
      ...records.slice(0, 3),
      {
        sequence: 4,
        monotonicMs: 4,
        topic: 'fetch/end',
        payload: {
          requestId: 'capture-error',
          capturedBytes: 7,
          responseBodyTruncated: true,
          responseCaptureError: 'AbortError: aborted',
        },
      },
    ])

    expect(sendEvent).toHaveBeenCalledWith('Network.loadingFinished', expect.objectContaining({
      requestId: requestId('capture-error'),
      encodedDataLength: 7,
      dshInspectorTruncated: true,
    }))
    expect(sendEvent.mock.calls.some(call => call[0] === 'Network.loadingFailed')).toBe(false)
    expect(network.handle('Network.getResponseBody', { requestId: requestId('capture-error') }, { sendEvent: vi.fn() }))
      .toMatchObject({
        body: Buffer.from('partial').toString('base64'),
        dshInspectorTruncated: true,
        dshInspectorCaptureError: 'AbortError: aborted',
      })
  })

  it('marks a failure after response headers truncated with the transport error', () => {
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    const observed: unknown[] = []
    const unsubscribe = store.subscribe((event) => { observed.push(event) })
    store.append(source, [
      ...requestRecords('midstream', 'partial').slice(0, 3),
      {
        sequence: 4,
        monotonicMs: 4,
        topic: 'fetch/error',
        payload: { requestId: 'midstream', message: 'socket reset', canceled: false },
      },
    ])

    expect(store.responseBody(requestId('midstream'))).toMatchObject({
      bytes: Buffer.from('partial'),
      truncated: true,
      captureError: 'socket reset',
      complete: true,
    })
    expect(observed.at(-1)).toMatchObject({ type: 'request-failed', errorText: 'socket reset', canceled: false })
    unsubscribe()
    store.dispose()
  })

  it('retains request capture metadata and isolates malformed observations', () => {
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    const observed: unknown[] = []
    store.subscribe(() => { throw new Error('broken observer') })
    const unsubscribe = store.subscribe((event) => { observed.push(event) })
    const start = requestRecords('metadata', 'response')[0]!
    store.append(source, [
      { ...start, topic: 'ignored/topic' },
      { ...start, payload: null },
      start,
      start,
      { sequence: 2, monotonicMs: 2, topic: 'fetch/request-body-chunk', payload: { requestId: 'metadata', data: Buffer.from('body').toString('base64') } },
      { sequence: 3, monotonicMs: 3, topic: 'fetch/request-body-end', payload: { requestId: 'metadata', truncated: true, captureError: 'request capture failed' } },
    ])
    expect(store.requestBody(requestId('metadata'))).toMatchObject({
      bytes: Buffer.from('body'),
      truncated: true,
      captureError: 'request capture failed',
      complete: false,
    })
    expect(() => store.responseBody(requestId('metadata'))).toThrow('response headers have not arrived')

    store.append(source, [
      requestRecords('metadata', 'response')[1]!,
      requestRecords('metadata', 'response')[2]!,
      {
        sequence: 4,
        monotonicMs: 4,
        topic: 'fetch/end',
        payload: {
          requestId: 'metadata',
          capturedBytes: 8,
          responseBodyTruncated: true,
          responseCaptureError: 'response capture failed',
        },
      },
      {
        sequence: 5,
        monotonicMs: 5,
        topic: 'fetch/error',
        payload: { requestId: 'metadata', message: 'late failure', canceled: false },
      },
    ])
    expect(store.responseBody(requestId('metadata'))).toMatchObject({
      bytes: Buffer.from('response'),
      truncated: true,
      captureError: 'response capture failed',
      complete: true,
    })
    expect(observed).toHaveLength(4)
    unsubscribe()
    store.dispose()
    expect(() => store.requestBody(requestId('metadata'))).toThrow('No resource with given identifier')
    expect(() => store.requestBody(1)).toThrow('Network requestId must be a string')
  })

  it('closes only active requests from the selected source and supports replacement', () => {
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    const observed: Array<{ type: string; requestId?: string }> = []
    store.subscribe((event) => { observed.push(event) })
    const clientSource: InspectorSourceDescriptor = {
      ...source,
      sourceId: inspectorId<'InspectorSourceId'>('other-network', 'sourceId'),
      generation: inspectorId<'InspectorSourceGeneration'>('other-generation', 'generation'),
      kind: 'client',
    }
    store.append(source, requestRecords('complete', 'done'))
    store.append(source, requestRecords('active', 'partial').slice(0, 3))
    store.append(clientSource, requestRecords('other', 'partial').slice(0, 3))

    store.close(source, 'source closed')
    expect(observed.filter(event => event.type === 'request-failed')).toEqual([
      expect.objectContaining({ requestId: requestId('active') }),
    ])
    store.close(source, 'source closed again')
    store.replace(clientSource, [])
    expect(observed.filter(event => event.type === 'request-failed')).toHaveLength(2)
  })

  it('rejects malformed fetch fields without losing later valid records', () => {
    const store = new NetworkStore({ maxRetainedRequests: 20, maxJournalBytes: 1_024 })
    const validStart = requestRecords('valid', 'ok')[0]!
    const malformed: IngestedInspectorRecord[] = [
      { ...validStart, payload: null },
      { ...validStart, payload: { ...validStart.payload as object, requestId: 1 } },
      { ...validStart, payload: { ...validStart.payload as object, wallTimeMs: Number.POSITIVE_INFINITY } },
      { ...validStart, payload: { ...validStart.payload as object, headers: {} } },
      { ...validStart, payload: { ...validStart.payload as object, headers: [[1, 'value']] } },
      { ...validStart, payload: { ...validStart.payload as object, hasBody: 'yes' } },
    ]
    store.append(source, [...malformed, validStart])
    const invalidPayloads: InspectorJsonValue[] = [
      { requestId: 'valid', data: '' },
      { requestId: 'valid', data: 'abc' },
      { requestId: 'valid', data: '!!!!' },
      { requestId: 'valid', data: 'ZE==' },
    ]
    store.append(source, invalidPayloads.map((payload, index) => ({
      sequence: index + 2,
      monotonicMs: index + 2,
      topic: 'fetch/request-body-chunk',
      payload,
    })))
    store.append(source, [
      { sequence: 10, monotonicMs: 10, topic: 'fetch/request-body-end', payload: { requestId: 'valid', truncated: 'yes' } },
      { sequence: 11, monotonicMs: 11, topic: 'fetch/request-body-end', payload: { requestId: 'valid', truncated: false, captureError: 1 } },
      { sequence: 12, monotonicMs: 12, topic: 'fetch/response', payload: { requestId: 'valid', url: 'https://example.test', status: '200', statusText: 'OK', headers: [], mimeType: 'text/plain' } },
      { sequence: 13, monotonicMs: 13, topic: 'fetch/response', payload: { requestId: 'valid', url: 'https://example.test', status: 200, statusText: 'OK', headers: [['bad']], mimeType: 'text/plain' } },
      requestRecords('valid', 'ok')[1]!,
      requestRecords('valid', 'ok')[2]!,
      requestRecords('valid', 'ok')[3]!,
      requestRecords('valid', 'ok')[3]!,
    ])

    expect(store.responseBody(requestId('valid')).bytes).toEqual(Buffer.from('ok'))

    const failedStart = requestRecords('failed-before-response', '')[0]!
    store.append(source, [failedStart, {
      sequence: 20,
      monotonicMs: 20,
      topic: 'fetch/error',
      payload: { requestId: 'failed-before-response', message: 'connection failed', canceled: false },
    }])
  })

  it('tracks zero-byte truncation and evicts a completed request before an active request', () => {
    const store = new NetworkStore({ maxRetainedRequests: 1, maxJournalBytes: 1 })
    store.append(source, requestRecords('completed', 'a'))
    const active = requestRecords('active', 'bc')
    store.append(source, [
      active[0]!,
      {
        sequence: 2,
        monotonicMs: 2,
        topic: 'fetch/request-body-chunk',
        payload: { requestId: 'active', data: Buffer.from('x').toString('base64') },
      },
      active[1]!,
      active[2]!,
    ])

    expect(() => store.requestBody(requestId('completed'))).toThrow('No resource with given identifier')
    expect(store.responseBody(requestId('active'))).toMatchObject({
      bytes: Buffer.alloc(0),
      truncated: true,
      complete: false,
    })

    store.append(source, [{
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/request-body-chunk',
      payload: { requestId: 'active', data: Buffer.from('d').toString('base64') },
    }])
    expect(store.requestBody(requestId('active'))).toMatchObject({ bytes: Buffer.from('x'), truncated: true })
  })

  it('rejects a non-list header field without dropping the active request', () => {
    const store = new NetworkStore({ maxRetainedRequests: 10, maxJournalBytes: 1_024 })
    const start = requestRecords('headers', 'ok')[0]!
    store.append(source, [{ ...start, payload: { ...start.payload as object, headers: null } }, start])

    expect(store.requestBody(requestId('headers')).complete).toBe(false)
  })
})

function requestRecords(localId: string, body: string): IngestedInspectorRecord[] {
  return [
    {
      sequence: 1,
      monotonicMs: 1,
      topic: 'fetch/start',
      payload: { requestId: localId, url: 'https://example.test/', method: 'GET', headers: [], hasBody: false, wallTimeMs: 1 },
    },
    {
      sequence: 2,
      monotonicMs: 2,
      topic: 'fetch/response',
      payload: { requestId: localId, url: 'https://example.test/', status: 200, statusText: 'OK', headers: [], mimeType: 'text/plain' },
    },
    {
      sequence: 3,
      monotonicMs: 3,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: localId, data: Buffer.from(body).toString('base64') },
    },
    {
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/end',
      payload: { requestId: localId, capturedBytes: body.length, responseBodyTruncated: false },
    },
  ]
}

function eventStreamRecords(localId: string): IngestedInspectorRecord[] {
  const first = 'id: 1\ndata: first\n\n'
  const second = 'id: 2\nevent: update\ndata: second\ndata: line\n\n'
  return [
    {
      sequence: 1,
      monotonicMs: 1,
      topic: 'fetch/start',
      payload: { requestId: localId, url: 'https://example.test/events', method: 'GET', headers: [], hasBody: false, wallTimeMs: 1 },
    },
    {
      sequence: 2,
      monotonicMs: 2,
      topic: 'fetch/response',
      payload: {
        requestId: localId,
        url: 'https://example.test/events',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream; charset=utf-8']],
        mimeType: 'TEXT/EVENT-STREAM',
      },
    },
    {
      sequence: 3,
      monotonicMs: 3,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: localId, data: Buffer.from(first).toString('base64') },
    },
    {
      sequence: 4,
      monotonicMs: 4,
      topic: 'fetch/response-body-chunk',
      payload: { requestId: localId, data: Buffer.from(second).toString('base64') },
    },
    {
      sequence: 5,
      monotonicMs: 5,
      topic: 'fetch/end',
      payload: { requestId: localId, capturedBytes: first.length + second.length, responseBodyTruncated: false },
    },
  ]
}

function requestId(localId: string): string {
  return `${source.sourceId}:${source.generation}:${localId}`
}
