/** Client-side non-CDP query bridge over the active Worker WebSocket. */

import type { InspectorSourceDescriptor } from '../../shared/bridge/messages/observation.ts'
import { InspectorQueryConnection } from '../../shared/bridge/rpc.ts'

/** Owns query correlation across reconnecting Client source generations. */
export class ClientBridgeRpc extends InspectorQueryConnection {
  /**
   * Connect query writes to one accepted Client WebSocket generation.
   * @param source - Accepted source descriptor.
   * @param socket - Active source WebSocket.
   */
  connectSocket(source: InspectorSourceDescriptor, socket: WebSocket): void {
    this.connect(source.sourceId, source.generation, {
      send: (frame) => {
        if (socket.readyState !== WebSocket.OPEN) throw new Error('Inspector Client query socket is not connected')
        socket.send(JSON.stringify(frame))
      },
    })
  }
}
