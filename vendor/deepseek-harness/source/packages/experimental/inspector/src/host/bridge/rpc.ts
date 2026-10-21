/** Host-side non-CDP query bridge over the Worker MessagePort. */

import type { MessagePort } from 'node:worker_threads'
import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { InspectorQueryConnection, type InspectorQueryConnectionOptions } from '../../shared/bridge/rpc.ts'

/** Owns query correlation for one Host source generation. */
export class HostBridgeRpc extends InspectorQueryConnection {
  constructor(private readonly port: MessagePort, options: InspectorQueryConnectionOptions) {
    super(options)
  }

  /**
   * Connect query writes after the Worker accepts the Host source.
   * @param source - Accepted Host source descriptor.
   */
  connectPort(source: InspectorSourceDescriptor): void {
    this.connect(source.sourceId, source.generation, {
      send: (frame) => { this.port.postMessage(frame) },
    })
  }
}
