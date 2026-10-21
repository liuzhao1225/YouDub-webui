/** Cordis service API shared by the Host and Client plugin faces. */

import type { CordisRuntimeTreeReader } from './cordis/reader.ts'
import { createQueryCordisRuntimeTreeReader } from './bridge/query-reader.ts'
import type { InspectorJsonValue } from './json.ts'
import type { InspectorConnection } from './bridge/publisher.ts'

/** Shared Host/Client service façade over the realm's source publisher. */
export interface InspectorService {
  /**
   * Publish one JSON observation without waiting for Worker delivery.
   * @param topic - Domain-owned topic name.
   * @param payload - JSON value validated before it reaches the carrier.
   * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
   */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void

  /** Read-only Cordis topology queries independent of CDP sessions. */
  readonly cordis: CordisRuntimeTreeReader
}

/**
 * Create the shared service façade without exposing the carrier implementation.
 * @param connection - Realm-local observation and query transport.
 * @returns The Cordis service value.
 */
export function createInspectorService(connection: InspectorConnection): InspectorService {
  return {
    publish: (topic, payload, monotonicMs) => { connection.publish(topic, payload, monotonicMs) },
    cordis: createQueryCordisRuntimeTreeReader(connection),
  }
}
