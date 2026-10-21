/** Host-to-Worker lifecycle messages and Worker readiness results. */

/** Fully resolved Worker configuration. */
export interface InspectorWorkerConfig {
  readonly host: '127.0.0.1'
  /** First port to bind; zero delegates selection to the operating system. */
  readonly startPort: number
  readonly targetId: string
  readonly clientToken: string
  readonly clientOrigins: readonly string[]
  readonly maxSourceFrameBytes: number
  readonly maxSourceRecordsPerFrame: number
  readonly maxRetainedRequests: number
  readonly maxJournalBytes: number
  readonly clientRuntimeTimeoutMs: number
  readonly maxClientSourceBytes: number
  readonly maxCordisNodes: number
  readonly maxDisconnectedCordisTrees: number
}

/** Structured-clone payload used to start the Inspector Worker. */
export interface InspectorWorkerBoot<Port> {
  readonly config: InspectorWorkerConfig
  readonly hostSourcePort: Port
}

/** Host request to stop accepting traffic and close every Worker-owned resource. */
export interface InspectorWorkerShutdown {
  readonly type: 'shutdown'
}

/** Every control message sent from Host to Worker after boot. */
export type InspectorHostControl = InspectorWorkerShutdown

/** Worker endpoint readiness. */
export interface InspectorWorkerReady {
  readonly type: 'ready'
  readonly host: string
  readonly port: number
  readonly targetId: string
}

/** Worker startup or runtime failure. */
export interface InspectorWorkerFailure {
  readonly type: 'failure'
  readonly message: string
}

/** Worker completed graceful shutdown. */
export interface InspectorWorkerStopped {
  readonly type: 'stopped'
}

/** Every control message sent from Worker to Host. */
export type InspectorWorkerControl = InspectorWorkerReady | InspectorWorkerFailure | InspectorWorkerStopped

/** Browser bootstrap injected by the Host plugin. */
export interface InspectorClientBootstrap {
  readonly endpoint: string
  readonly protocol: string
  readonly maxQueuedRecords: number
  readonly maxQueuedBytes: number
  readonly maxRecordsPerFrame: number
  readonly maxFrameBytes: number
  readonly reconnectBaseMs: number
  readonly reconnectMaxMs: number
  readonly queryTimeoutMs: number
  readonly maxRuntimeObjectsPerSession: number
  readonly maxRuntimePropertiesPerResult: number
  readonly maxClientSourceBytes: number
  readonly maxCordisNodes: number
}
