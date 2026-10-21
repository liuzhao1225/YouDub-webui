/** CDP Network projection over the Worker-owned normalized network store. */

import { Buffer } from 'node:buffer'
import type { InspectorHeader } from '../../../../shared/network/observation.ts'
import type { NetworkStore, NetworkStoreEvent } from '../../../inspection/network-store.ts'

/** CDP session slice used by the Network domain. */
export interface NetworkSink {
  sendEvent(method: string, params: Readonly<Record<string, unknown>>): void
}

type RequestStartedEvent = Extract<NetworkStoreEvent, { readonly type: 'request-started' }>
type NetworkResourceType = 'EventSource' | 'Fetch'

/** Projects retained and live network observations into connection-local CDP state. */
export class NetworkDomain {
  private readonly enabled = new Set<NetworkSink>()
  private readonly streamedRequests = new Map<NetworkSink, Set<string>>()
  private readonly pendingStarts = new Map<NetworkSink, Map<string, RequestStartedEvent>>()
  private readonly requestTypes = new Map<NetworkSink, Map<string, NetworkResourceType>>()
  private readonly unsubscribe: () => void

  constructor(private readonly store: NetworkStore) {
    this.unsubscribe = store.subscribe((event) => { this.receive(event) })
  }

  /**
   * Enable Network for one DevTools connection and replay retained lifecycle events.
   * @param session - Connection receiving replay and subsequent events.
   */
  enable(session: NetworkSink): void {
    if (this.enabled.has(session)) return
    this.enabled.add(session)
    this.pendingStarts.set(session, new Map())
    this.requestTypes.set(session, new Map())
    for (const event of this.store.replay()) this.send(session, event)
  }

  /**
   * Stop Network events for one DevTools connection.
   * @param session - Connection leaving the enabled set.
   */
  disable(session: NetworkSink): void {
    this.enabled.delete(session)
    this.streamedRequests.delete(session)
    this.pendingStarts.delete(session)
    this.requestTypes.delete(session)
  }

  /**
   * Forget a closed DevTools connection.
   * @param session - Closed DevTools connection.
   */
  detach(session: NetworkSink): void {
    this.disable(session)
  }

  /** Release the repository subscription and all connection-local state. */
  close(): void {
    this.unsubscribe()
    this.enabled.clear()
    this.streamedRequests.clear()
    this.pendingStarts.clear()
    this.requestTypes.clear()
  }

  /**
   * Handle one Worker-local Network method.
   * @param method - CDP method name.
   * @param params - Parsed request parameters.
   * @param session - Calling DevTools connection.
   * @returns The CDP result fields.
   */
  handle(method: string, params: Readonly<Record<string, unknown>>, session: NetworkSink): unknown {
    switch (method) {
      case 'Network.enable':
        this.enable(session)
        return {}
      case 'Network.disable':
        this.disable(session)
        return {}
      case 'Network.getResponseBody': {
        const body = this.store.responseBody(params.requestId)
        return {
          body: Buffer.from(body.bytes).toString('base64'),
          base64Encoded: true,
          dshInspectorTruncated: body.truncated,
          ...(body.captureError === undefined ? {} : { dshInspectorCaptureError: body.captureError }),
        }
      }
      case 'Network.getRequestPostData': {
        const body = this.store.requestBody(params.requestId)
        return {
          postData: Buffer.from(body.bytes).toString('utf8'),
          dshInspectorTruncated: body.truncated,
          ...(body.captureError === undefined ? {} : { dshInspectorCaptureError: body.captureError }),
        }
      }
      case 'Network.streamResourceContent': {
        const body = this.store.responseBody(params.requestId)
        if (typeof params.requestId !== 'string') throw new Error('Network requestId must be a string')
        if (!body.complete) {
          let requests = this.streamedRequests.get(session)
          if (requests === undefined) this.streamedRequests.set(session, requests = new Set())
          requests.add(params.requestId)
        }
        return { bufferedData: Buffer.from(body.bytes).toString('base64') }
      }
      case 'Network.setCacheDisabled':
      case 'Network.setBypassServiceWorker':
      case 'Network.setExtraHTTPHeaders':
      case 'Network.clearBrowserCache':
      case 'Network.clearBrowserCookies':
        return {}
      default:
        throw new Error(`unsupported Network method ${method}`)
    }
  }

  private receive(event: NetworkStoreEvent): void {
    if (event.type === 'request-evicted') {
      for (const [session, requests] of this.streamedRequests) {
        requests.delete(event.requestKey)
        if (requests.size === 0) this.streamedRequests.delete(session)
      }
      for (const requests of this.pendingStarts.values()) requests.delete(event.requestKey)
      for (const requests of this.requestTypes.values()) requests.delete(event.requestKey)
      return
    }
    for (const session of this.enabled) this.send(session, event)
  }

  private send(session: NetworkSink, event: Exclude<NetworkStoreEvent, { readonly type: 'request-evicted' }>): void {
    const timestamp = (event.timestampMs - performance.timeOrigin) / 1_000
    switch (event.type) {
      case 'request-started':
        this.pendingStarts.get(session)?.set(event.requestKey, event)
        return
      case 'response-received': {
        const resourceType = event.mimeType === 'text/event-stream' ? 'EventSource' : 'Fetch'
        this.sendRequestStart(session, event.requestKey, resourceType)
        session.sendEvent('Network.responseReceived', {
          requestId: event.requestId,
          loaderId: 'dsh-inspector-loader',
          frameId: 'dsh-inspector-host-frame',
          timestamp,
          type: resourceType,
          response: {
            url: event.url,
            status: event.status,
            statusText: event.statusText,
            headers: cdpHeaders(event.headers),
            mimeType: event.mimeType,
            connectionReused: false,
            connectionId: 0,
            encodedDataLength: resourceType === 'EventSource' ? -1 : 0,
            securityState: 'neutral',
          },
        })
        return
      }
      case 'event-source-message':
        session.sendEvent('Network.eventSourceMessageReceived', {
          requestId: event.requestId,
          timestamp,
          eventName: event.eventName,
          eventId: event.eventId,
          data: event.data,
        })
        return
      case 'response-data':
        session.sendEvent('Network.dataReceived', {
          requestId: event.requestId,
          timestamp,
          dataLength: event.byteLength,
          encodedDataLength: event.byteLength,
          ...(this.streamedRequests.get(session)?.has(event.requestKey) === true ? { data: event.data } : {}),
        })
        return
      case 'request-finished':
        this.sendRequestStart(session, event.requestKey, 'Fetch')
        session.sendEvent('Network.loadingFinished', {
          requestId: event.requestId,
          timestamp,
          encodedDataLength: event.encodedDataLength,
          dshInspectorTruncated: event.truncated,
        })
        this.stopRequest(session, event.requestKey)
        return
      case 'request-failed': {
        this.sendRequestStart(session, event.requestKey, 'Fetch')
        const resourceType = this.requestTypes.get(session)?.get(event.requestKey) ?? 'Fetch'
        session.sendEvent('Network.loadingFailed', {
          requestId: event.requestId,
          timestamp,
          type: resourceType,
          errorText: event.errorText,
          canceled: event.canceled,
        })
        this.stopRequest(session, event.requestKey)
        return
      }
      default:
        return assertNever(event)
    }
  }

  private sendRequestStart(session: NetworkSink, requestKey: string, resourceType: NetworkResourceType): void {
    const pending = this.pendingStarts.get(session)
    const event = pending?.get(requestKey)
    if (event === undefined) return
    pending?.delete(requestKey)
    this.requestTypes.get(session)?.set(requestKey, resourceType)
    session.sendEvent('Network.requestWillBeSent', {
      requestId: event.requestId,
      loaderId: 'dsh-inspector-loader',
      documentURL: 'dsh://host',
      request: {
        url: event.url,
        method: event.method,
        headers: cdpHeaders(event.headers),
        hasPostData: event.hasBody,
      },
      timestamp: (event.timestampMs - performance.timeOrigin) / 1_000,
      wallTime: event.wallTimeMs / 1_000,
      initiator: { type: 'other' },
      type: resourceType,
    })
  }

  private stopRequest(session: NetworkSink, requestKey: string): void {
    const streamed = this.streamedRequests.get(session)
    streamed?.delete(requestKey)
    if (streamed?.size === 0) this.streamedRequests.delete(session)
    this.pendingStarts.get(session)?.delete(requestKey)
    this.requestTypes.get(session)?.delete(requestKey)
  }
}

function cdpHeaders(entries: readonly InspectorHeader[]): Record<string, string> {
  const headers: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [name, value] of entries) {
    headers[name] = headers[name] === undefined ? value : `${headers[name]}\n${value}`
  }
  return headers
}

function assertNever(value: never): never {
  throw new Error(`Unexpected network event: ${JSON.stringify(value)}`)
}
