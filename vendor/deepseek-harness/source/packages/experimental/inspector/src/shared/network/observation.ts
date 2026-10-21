/** Full-capture fetch observations sent to the Inspector Worker. */

/** One header entry; arrays retain duplicate header names. */
export type InspectorHeader = readonly [name: string, value: string]

/** Common request identity. */
export interface FetchIdentity {
  readonly requestId: string
}

/** A high-level global fetch call began. */
export interface FetchStartPayload extends FetchIdentity {
  readonly url: string
  readonly method: string
  readonly headers: InspectorHeader[]
  readonly hasBody: boolean
  readonly wallTimeMs: number
}

/** One captured request-body chunk. */
export interface FetchBodyChunkPayload extends FetchIdentity {
  readonly data: string
}

/** Terminal state of one captured request body. */
export interface FetchRequestBodyEndPayload extends FetchIdentity {
  readonly capturedBytes: number
  readonly truncated: boolean
  readonly captureError?: string
}

/** Fetch resolved with response headers. */
export interface FetchResponsePayload extends FetchIdentity {
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: InspectorHeader[]
  readonly mimeType: string
}

/** One captured response-body chunk. */
/** Fetch capture reached a terminal response-body state. */
export interface FetchEndPayload extends FetchIdentity {
  readonly capturedBytes: number
  readonly responseBodyTruncated: boolean
  readonly responseCaptureError?: string
}

/** One parsed Server-Sent Event independent of its CDP projection. */
export interface InspectorEventSourceMessage {
  readonly eventName: string
  readonly eventId: string
  readonly data: string
}

/** Fetch rejected before returning a Response. */
export interface FetchErrorPayload extends FetchIdentity {
  readonly message: string
  readonly canceled: boolean
}
