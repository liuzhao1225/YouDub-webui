/**
 * `ws` stub. `WebSocketDownlinks` constructs a `WebSocketServer` in a field
 * initializer as soon as Connection is present, so the class must be constructible;
 * no method is ever reached because the fake HTTP server never emits `upgrade`
 * (the tunnel carries downstream events over the SSE branch instead).
 */
import { notImplementedFail } from '../notImplementedFail.ts'

const MODULE = 'ws'

/** Client socket (unavailable; the page side uses the tunnel, not WebSocket). */
/** CommonJS interop marker: the worker loader hands `default` to default imports (see ./builtins.ts). */
export const __esModule = true

/** Client socket (unavailable; the page side uses the tunnel, not WebSocket). */
export default class WebSocket {
  /** Node's `CONNECTING` ready state, read by consumers that never connect. */
  static readonly CONNECTING = 0
  /** Node's `OPEN` ready state. */
  static readonly OPEN = 1
  /** Node's `CLOSING` ready state. */
  static readonly CLOSING = 2
  /** Node's `CLOSED` ready state. */
  static readonly CLOSED = 3

  constructor() {
    throw new Error(`web-preview: ${MODULE} client sockets are not available in the worker host`)
  }
}

/** Server whose construction must succeed and whose methods are unreachable. */
export class WebSocketServer {
  /** Connected clients: always empty, since no upgrade ever completes. */
  readonly clients = new Set<never>()

  /** Upgrade handling (unreachable: no upgrade event is ever emitted). */
  readonly handleUpgrade = notImplementedFail(MODULE, 'WebSocketServer.handleUpgrade')

  /** Broadcast helper (unreachable). */
  readonly emit = notImplementedFail(MODULE, 'WebSocketServer.emit')

  /**
   * Register a listener; nothing is ever emitted.
   * @returns this server.
   */
  on(): this {
    return this
  }

  /**
   * Close the server.
   * @param callback - completion callback, invoked immediately.
   */
  close(callback?: () => void): void {
    callback?.()
  }
}

/** Alias Node consumers sometimes import. */
export const Server = WebSocketServer

export { WebSocket }
