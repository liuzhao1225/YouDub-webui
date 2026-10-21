/** Shared Host/Client owner of correlated non-CDP query requests. */

import { inspectorId, type InspectorSourceGeneration, type InspectorSourceId } from './ids.ts'
import { jsonByteLength, type InspectorJsonValue } from '../json.ts'
import { INSPECTOR_PROTOCOL_VERSION } from './version.ts'
import type {
  InspectorQuery,
  InspectorQueryError,
  InspectorQueryRequester,
  InspectorQueryResult,
  InspectorQueryResultFor,
} from './messages/query/commands.ts'
import { isInspectorQueryResponseEnvelope, parseInspectorQueryResponseFrame } from './messages/query/codec.ts'
import type { InspectorQueryRequestFrame, InspectorQueryRequestId } from './messages/query/frames.ts'

/** Active carrier write used by the shared query owner. */
export interface InspectorQuerySender {
  /**
   * Send one validated query request frame.
   * @param frame - Request belonging to the active source generation.
   */
  send(frame: InspectorQueryRequestFrame): void
}

/** Bounds applied by one Host or Client query connection. */
export interface InspectorQueryConnectionOptions {
  readonly timeoutMs: number
  readonly maxFrameBytes: number
}

interface PendingQuery {
  readonly op: string
  readonly resolve: (result: InspectorQueryResult) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface QueryGeneration {
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly sender: InspectorQuerySender
}

/** Failure deliberately returned by the Worker query handler. */
export class InspectorQueryRemoteError extends Error {
  constructor(readonly code: InspectorQueryError['code'], message: string) {
    super(message)
  }
}

/** Correlates requests for one reconnecting Host or Client source. */
export class InspectorQueryConnection implements InspectorQueryRequester {
  private readonly pending = new Map<InspectorQueryRequestId, PendingQuery>()
  private active: QueryGeneration | undefined
  private nextRequestId = 0
  private closed = false

  constructor(private readonly options: InspectorQueryConnectionOptions) {}

  /**
   * Admit the source generation acknowledged by the Worker.
   * @param sourceId - Stable source identity.
   * @param generation - Newly accepted transport generation.
   * @param sender - Carrier writer valid for that generation.
   */
  connect(sourceId: InspectorSourceId, generation: InspectorSourceGeneration, sender: InspectorQuerySender): void {
    if (this.closed) throw new Error('inspector query connection is closed')
    this.disconnect('Inspector source generation replaced')
    this.active = { sourceId, generation, sender }
  }

  /**
   * Execute a query against the currently accepted source generation.
   * @param query - Closed typed query command.
   * @returns The result with the same operation discriminant.
   */
  request<Query extends InspectorQuery>(query: Query): Promise<InspectorQueryResultFor<Query>> {
    const active = this.active
    if (this.closed || active === undefined) {
      return Promise.reject(new Error('Inspector query transport is not connected'))
    }
    const requestId = inspectorId<'InspectorQueryRequestId'>(`query-${String(++this.nextRequestId)}`, 'requestId')
    const frame: InspectorQueryRequestFrame = {
      v: INSPECTOR_PROTOCOL_VERSION,
      t: 'query/request',
      sourceId: active.sourceId,
      generation: active.generation,
      requestId,
      query,
    }
    if (jsonByteLength(frame as unknown as InspectorJsonValue) > this.options.maxFrameBytes) {
      return Promise.reject(new Error(`Inspector query request exceeds ${String(this.options.maxFrameBytes)} bytes`))
    }
    const result = new Promise<InspectorQueryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Inspector query ${query.op} timed out after ${String(this.options.timeoutMs)}ms`))
      }, this.options.timeoutMs)
      this.pending.set(requestId, { op: query.op, resolve, reject, timer })
      try {
        active.sender.send(frame)
      } catch (error) {
        this.rejectPending(requestId, renderError(error))
      }
    })
    return result as Promise<InspectorQueryResultFor<Query>>
  }

  /**
   * Consume a decoded carrier value when it is a query response.
   * @param value - Untrusted Worker-to-source value.
   * @returns Whether the value belonged to the query protocol.
   */
  receive(value: unknown): boolean {
    if (!isInspectorQueryResponseEnvelope(value)) return false
    let frame
    try {
      frame = parseInspectorQueryResponseFrame(value)
      if (jsonByteLength(frame as unknown as InspectorJsonValue) > this.options.maxFrameBytes) {
        throw new Error(`inspector protocol: query response exceeds ${String(this.options.maxFrameBytes)} bytes`)
      }
    } catch (error) {
      this.disconnect(`Invalid Inspector query response: ${renderError(error).message}`)
      throw error
    }
    const pending = this.pending.get(frame.requestId)
    if (pending === undefined) return true
    const active = this.active
    if (active === undefined || frame.sourceId !== active.sourceId || frame.generation !== active.generation) {
      this.rejectPending(frame.requestId, new Error('Inspector query response source generation does not match'))
      return true
    }
    if (!frame.outcome.ok) {
      this.rejectPending(frame.requestId, new InspectorQueryRemoteError(
        frame.outcome.error.code,
        frame.outcome.error.message,
      ))
      return true
    }
    if (frame.outcome.result.op !== pending.op) {
      this.rejectPending(frame.requestId, new Error(
        `Inspector query response op ${frame.outcome.result.op} does not match ${pending.op}`,
      ))
      return true
    }
    clearTimeout(pending.timer)
    this.pending.delete(frame.requestId)
    pending.resolve(frame.outcome.result)
    return true
  }

  /**
   * Reject active requests while permitting a later source generation.
   * @param reason - Failure reported to every pending caller.
   */
  disconnect(reason: string): void {
    this.active = undefined
    for (const requestId of [...this.pending.keys()]) this.rejectPending(requestId, new Error(reason))
  }

  /**
   * Permanently reject requests and prevent later reconnection.
   * @param reason - Failure reported to every pending caller.
   */
  close(reason = 'Inspector query connection closed'): void {
    if (this.closed) return
    this.closed = true
    this.disconnect(reason)
  }

  private rejectPending(requestId: InspectorQueryRequestId, error: Error): void {
    const pending = this.pending.get(requestId)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    pending.reject(error)
  }
}

function renderError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
