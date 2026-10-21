/** Buffered Host observation publication over a dedicated Worker MessagePort. */

import type { MessagePort } from 'node:worker_threads'
import { InspectorSourceBuffer, type InspectorSourceBufferOptions } from '../../shared/bridge/buffer.ts'
import type { InspectorJsonValue } from '../../shared/json.ts'
import type { InspectorStatePublisher } from '../../shared/bridge/publisher.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'

/** Non-blocking Host publisher with microtask-coalesced MessagePort writes. */
export class HostBridgePublisher implements InspectorStatePublisher {
  private readonly records: InspectorSourceBuffer
  private flushScheduled = false
  private inFlightNextSequence: number | undefined
  private closed = false

  constructor(
    private readonly port: MessagePort,
    private readonly source: InspectorSourceDescriptor,
    options: InspectorSourceBufferOptions,
  ) {
    this.records = new InspectorSourceBuffer(options)
  }

  publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    if (this.closed) return
    this.records.publish(topic, payload, monotonicMs)
    this.scheduleFlush()
  }

  setState(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    if (this.closed) throw new Error('inspector: Host source is closed')
    this.records.setState(topic, payload, monotonicMs)
    this.scheduleFlush()
  }

  /** Send the retained state as a complete source replacement. */
  replace(): void {
    this.inFlightNextSequence = undefined
    this.port.postMessage(this.records.replacement(this.source.sourceId, this.source.generation))
    this.scheduleFlush()
  }

  /** Send one queued batch when no earlier MessagePort batch awaits acknowledgement. */
  flush(): void {
    if (this.closed || this.inFlightNextSequence !== undefined) return
    const frame = this.records.takeBatch(this.source.sourceId, this.source.generation)
    if (frame === undefined) return
    this.port.postMessage(frame)
    this.inFlightNextSequence = frame.firstSequence + frame.records.length
  }

  /**
   * Release one in-flight batch and schedule the next bounded transfer.
   * @param nextSequence - First sequence expected by the Worker after the accepted batch.
   */
  acknowledge(nextSequence: number): void {
    if (this.closed || this.inFlightNextSequence === undefined) return
    if (nextSequence !== this.inFlightNextSequence) {
      throw new Error('inspector: Host source acknowledgement does not match the in-flight batch')
    }
    this.inFlightNextSequence = undefined
    this.scheduleFlush()
  }

  /** Send at most one final batch, discard later queued observations, and reject publication. */
  close(): void {
    if (this.closed) return
    this.flush()
    this.closed = true
    this.records.discardPending()
  }

  private scheduleFlush(): void {
    if (!this.records.hasPending || this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      this.flush()
    })
  }
}
