/** Buffered Client observation publication across reconnecting WebSockets. */

import { InspectorSourceBuffer, type InspectorSourceBufferOptions } from '../../shared/bridge/buffer.ts'
import type { InspectorJsonValue } from '../../shared/json.ts'
import type { InspectorStatePublisher } from '../../shared/bridge/publisher.ts'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'

interface ActivePublication {
  readonly socket: WebSocket
  readonly source: InspectorSourceDescriptor
  accepted: boolean
}

/** Non-blocking Client publisher whose bounded state survives transport reconnects. */
export class ClientBridgePublisher implements InspectorStatePublisher {
  private readonly records: InspectorSourceBuffer
  private active: ActivePublication | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(
    options: InspectorSourceBufferOptions,
    private readonly maxBufferedBytes: number,
  ) {
    this.records = new InspectorSourceBuffer(options)
  }

  publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    if (this.closed) return
    this.records.publish(topic, payload, monotonicMs)
    this.flush()
  }

  setState(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    if (this.closed) throw new Error('inspector: Client source is closed')
    this.records.setState(topic, payload, monotonicMs)
    this.flush()
  }

  /**
   * Install one unopened transport generation.
   * @param socket - WebSocket carrying the generation.
   * @param source - Source identity and generation sent by the socket.
   */
  connect(socket: WebSocket, source: InspectorSourceDescriptor): void {
    this.active = { socket, source, accepted: false }
  }

  /**
   * Send retained state and queued observations after Worker acceptance.
   * @param socket - Accepted active WebSocket.
   */
  accept(socket: WebSocket): void {
    const active = this.active
    if (active?.socket !== socket) return
    active.accepted = true
    this.replace(socket)
    this.flush()
  }

  /**
   * Resend retained state for the active generation.
   * @param socket - WebSocket that received the resnapshot request.
   */
  replace(socket: WebSocket): void {
    const active = this.active
    if (active?.socket !== socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(this.records.replacement(active.source.sourceId, active.source.generation)))
  }

  /**
   * Forget one closed transport while retaining buffered state for reconnect.
   * @param socket - WebSocket whose close event fired.
   */
  disconnect(socket: WebSocket): void {
    if (this.active?.socket === socket) this.active = undefined
  }

  /** Stop delayed writes and reject later publication. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.active = undefined
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  private flush(): void {
    const active = this.active
    if (!active?.accepted || active.socket.readyState !== WebSocket.OPEN) return
    if (active.socket.bufferedAmount > this.maxBufferedBytes) {
      this.scheduleFlush()
      return
    }
    while (this.records.hasPending && active.socket.bufferedAmount <= this.maxBufferedBytes) {
      const frame = this.records.takeBatch(active.source.sourceId, active.source.generation)
      if (frame === undefined) break
      active.socket.send(JSON.stringify(frame))
    }
    if (this.records.hasPending) this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.closed) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, 25)
  }
}
