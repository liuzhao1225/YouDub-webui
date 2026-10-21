/** Worker-side source buffer behavior. */

import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { HostBridgePublisher } from '../src/host/bridge/publisher.ts'
import { inspectorId } from '../src/shared/bridge/ids.ts'
import { InspectorSourceBuffer, type InspectorSourceBufferOptions } from '../src/shared/bridge/buffer.ts'
import type { InspectorSourceDescriptor } from '../src/shared/bridge/messages/observation.ts'

const sourceId = inspectorId<'InspectorSourceId'>('source-buffer-test', 'sourceId')
const generation = inspectorId<'InspectorSourceGeneration'>('generation-buffer-test', 'generation')
const source: InspectorSourceDescriptor = {
  sourceId,
  generation,
  kind: 'host',
  label: 'Host',
  timeOriginMs: performance.timeOrigin,
  capabilities: [],
}

function buffer(
  maxQueuedRecords = 2,
  overrides: Partial<InspectorSourceBufferOptions> = {},
): InspectorSourceBuffer {
  return new InspectorSourceBuffer({
    topics: ['*'],
    maxQueuedRecords,
    maxQueuedBytes: 32_768,
    maxRecordsPerFrame: 8,
    maxFrameBytes: 32_768,
    ...overrides,
  })
}

describe('Inspector source buffer', () => {
  it('absorbs pre-replacement queue loss exactly once', () => {
    const records = buffer(1)
    expect(records.replacement(sourceId, generation)).toMatchObject({ nextSequence: 1, records: [] })
    records.publish('test/event', { ordinal: 1 }, 1)
    records.publish('test/event', { ordinal: 2 }, 2)

    expect(records.replacement(sourceId, generation)).toMatchObject({
      nextSequence: 2,
      records: [],
    })
    expect(records.takeBatch(sourceId, generation)).toMatchObject({
      firstSequence: 2,
      droppedBefore: 0,
      records: [{ topic: 'test/event', payload: { ordinal: 2 } }],
    })
  })

  it('validates records before either carrier can enqueue them', () => {
    const records = buffer()

    expect(() => { records.publish('', {}, 1) }).toThrow('topic must contain 1 to 128 characters')
    expect(() => { records.publish('x'.repeat(129), {}, 1) }).toThrow('topic must contain 1 to 128 characters')
    expect(() => { buffer(2, { topics: ['declared'] }).publish('undeclared', {}, 1) })
      .toThrow('source does not declare topic')
    expect(() => { records.publish('test/event', {}, Number.NaN) }).toThrow('monotonicMs must be finite')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => { records.publish('test/event', cyclic as never, 1) }).toThrow('lossless JSON data')
  })

  it('rejects oversized retained state without replacing the previous value', () => {
    const records = buffer(4, { maxFrameBytes: 4_300 })
    records.setState('state', { value: 'kept' }, 1)
    expect(() => { records.setState('state', { value: 'x'.repeat(1_000) }, 2) })
      .toThrow('source state exceeds the source-frame byte limit')
    expect(() => { records.setState('other', { value: 'x'.repeat(1_000) }, 3) })
      .toThrow('source state exceeds the source-frame byte limit')
    expect(records.replacement(sourceId, generation).records).toEqual([
      { topic: 'state', payload: { value: 'kept' }, monotonicMs: 1 },
    ])
  })

  it('splits frames at record, byte, and sequence gaps and discards pending records', () => {
    const records = buffer(10, { maxRecordsPerFrame: 2, maxFrameBytes: 4_300 })
    expect(records.hasPending).toBe(false)
    records.publish('test/event', { value: 'a'.repeat(40) }, 1)
    records.publish('test/event', { value: 'x'.repeat(1_000) }, 2)
    records.publish('test/event', { value: 'b'.repeat(40) }, 3)
    expect(records.hasPending).toBe(true)

    expect(records.takeBatch(sourceId, generation)).toMatchObject({ firstSequence: 1, records: [{ monotonicMs: 1 }] })
    expect(records.takeBatch(sourceId, generation)).toMatchObject({
      firstSequence: 3,
      droppedBefore: 1,
      records: [{ monotonicMs: 3 }],
    })
    expect(records.takeBatch(sourceId, generation)).toBeUndefined()

    records.publish('test/event', { ordinal: 4 }, 4)
    records.discardPending()
    expect(records.hasPending).toBe(false)

    const byteSplit = buffer(10, { maxFrameBytes: 4_300 })
    byteSplit.publish('test/event', { value: 'a'.repeat(100) }, 1)
    byteSplit.publish('test/event', { value: 'b'.repeat(100) }, 2)
    expect(byteSplit.takeBatch(sourceId, generation)?.records).toHaveLength(1)
    expect(byteSplit.takeBatch(sourceId, generation)?.records).toHaveLength(1)
  })

  it('drops queued records against the byte limit independently of the item limit', () => {
    const records = buffer(10, { maxQueuedBytes: 120 })
    records.publish('test/event', { value: 'a'.repeat(40) }, 1)
    records.publish('test/event', { value: 'b'.repeat(40) }, 2)

    expect(records.takeBatch(sourceId, generation)).toMatchObject({
      firstSequence: 2,
      droppedBefore: 1,
      records: [{ monotonicMs: 2 }],
    })
  })

  it('keeps at most one Host MessagePort observation batch in flight', async () => {
    const channel = new MessageChannel()
    const messages: unknown[] = []
    channel.port2.on('message', (message) => { messages.push(message) })
    channel.port2.start()
    const publisher = new HostBridgePublisher(channel.port1, source, {
      topics: ['*'],
      maxQueuedRecords: 2,
      maxQueuedBytes: 32_768,
      maxRecordsPerFrame: 1,
      maxFrameBytes: 32_768,
    })
    try {
      publisher.publish('test/event', { ordinal: 1 })
      publisher.flush()
      publisher.publish('test/event', { ordinal: 2 })
      publisher.publish('test/event', { ordinal: 3 })
      await vi.waitFor(() => { expect(messages).toHaveLength(1) })
      const first = messages[0] as { firstSequence: number; records: Array<{ payload: unknown }> }
      expect(first.records).toHaveLength(1)
      expect(first.records[0]?.payload).toEqual({ ordinal: 1 })

      publisher.acknowledge(first.firstSequence + first.records.length)
      await vi.waitFor(() => { expect(messages).toHaveLength(2) })
      const second = messages[1] as { firstSequence: number; droppedBefore: number; records: Array<{ payload: unknown }> }
      expect(second).toMatchObject({
        firstSequence: 2,
        droppedBefore: 0,
        records: [{ payload: { ordinal: 2 } }],
      })
      publisher.acknowledge(second.firstSequence + second.records.length)
      await vi.waitFor(() => { expect(messages).toHaveLength(3) })
      expect(messages[2]).toMatchObject({
        firstSequence: 3,
        records: [{ payload: { ordinal: 3 } }],
      })
    } finally {
      publisher.close()
      channel.port1.close()
      channel.port2.close()
    }
  })
})
