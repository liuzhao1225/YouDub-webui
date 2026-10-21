/** Host-realm observation publisher over a dedicated MessagePort. */

import type { MessagePort } from 'node:worker_threads'
import {
  INSPECTOR_PROTOCOL_VERSION,
  parseWorkerSourceFrame,
  type SourceCloseFrame,
  type SourceOpenFrame,
  type WorkerToSourceFrame,
} from '../../shared/bridge/messages/observation.ts'
import { InspectorSourceConnection } from '../../shared/bridge/publisher.ts'
import { createHostRealmSource } from '../inspection/realm.ts'
import { HostBridgePublisher } from './publisher.ts'
import { HostBridgeRpc } from './rpc.ts'
import { dispatchBridgeFrame } from './dispatcher.ts'

/** Buffer limits for one source publisher. */
export interface HostSourceOptions {
  readonly label: string
  readonly topics: readonly string[]
  readonly maxQueuedRecords: number
  readonly maxQueuedBytes: number
  readonly maxRecordsPerFrame: number
  readonly maxFrameBytes: number
  readonly queryTimeoutMs: number
}

/** Non-blocking Host source; queue overflow is represented by `droppedBefore` on the next batch. */
export class HostInspectorSource extends InspectorSourceConnection {
  private readonly source
  protected readonly publisher: HostBridgePublisher
  private closed = false
  protected readonly queries: HostBridgeRpc

  constructor(private readonly port: MessagePort, options: HostSourceOptions) {
    super()
    this.source = createHostRealmSource(options.label)
    this.publisher = new HostBridgePublisher(port, this.source, options)
    this.queries = new HostBridgeRpc(port, {
      timeoutMs: options.queryTimeoutMs,
      maxFrameBytes: options.maxFrameBytes,
    })
    port.on('message', (value: unknown) => {
      try {
        if (this.queries.receive(value)) return
        this.receive(parseWorkerSourceFrame(value))
      } catch {
        this.close()
      }
    })
    port.on('close', () => { this.queries.disconnect('Inspector Host source disconnected') })
    port.start()
    const open: SourceOpenFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/open',
      source: this.source,
      topics: [...options.topics],
    }
    port.postMessage(open)
    this.publisher.replace()
  }

  /** Flush pending observations and close the source port. */
  close(): void {
    if (this.closed) return
    this.publisher.close()
    this.closed = true
    this.queries.close('Inspector Host source closed')
    const frame: SourceCloseFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'source/close',
      sourceId: this.source.sourceId,
      generation: this.source.generation,
    }
    this.port.postMessage(frame)
    this.port.close()
  }

  private receive(frame: WorkerToSourceFrame): void {
    if (frame.t !== 'source/rejected'
      && (frame.sourceId !== this.source.sourceId || frame.generation !== this.source.generation)) return
    dispatchBridgeFrame(frame, {
      accepted: () => { this.queries.connectPort(this.source) },
      acknowledged: (acknowledged) => { this.publisher.acknowledge(acknowledged.nextSequence) },
      resnapshot: () => { this.publisher.replace() },
      rejected: (rejected) => { this.queries.disconnect(`Inspector Host source rejected: ${rejected.message}`) },
    })
  }
}
