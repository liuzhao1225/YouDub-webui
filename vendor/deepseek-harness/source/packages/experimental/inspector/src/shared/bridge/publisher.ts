/** Source-side interfaces shared by MessagePort and WebSocket bridge implementations. */

import type { InspectorJsonValue } from '../json.ts'
import type { InspectorQuery, InspectorQueryRequester, InspectorQueryResultFor } from './messages/query/commands.ts'

/** Transport-independent observation publisher. */
export interface InspectorPublisher {
  /** Publish one validated observation. */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
}

/** Publisher that also retains the latest value of stateful observation topics. */
export interface InspectorStatePublisher extends InspectorPublisher {
  /**
   * Replace one topic's retained state and publish the replacement.
   * @param topic - Domain-owned state topic.
   * @param payload - Latest JSON state, replayed after source resynchronization.
   * @param monotonicMs - Source-clock timestamp; defaults to `performance.now()`.
   */
  setState(topic: string, payload: InspectorJsonValue, monotonicMs?: number): void
}

/** Shared capabilities exposed above a Host MessagePort or Client WebSocket carrier. */
export interface InspectorConnection extends InspectorStatePublisher, InspectorQueryRequester {}

/** Shared observation and query delegation inherited by both source transports. */
export abstract class InspectorSourceConnection implements InspectorConnection {
  protected abstract readonly publisher: InspectorStatePublisher
  protected abstract readonly queries: InspectorQueryRequester

  /** Publish one JSON observation without waiting on its carrier. */
  publish(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    this.publisher.publish(topic, payload, monotonicMs)
  }

  /** Retain and publish one state value for reconnect or replacement recovery. */
  setState(topic: string, payload: InspectorJsonValue, monotonicMs = performance.now()): void {
    this.publisher.setState(topic, payload, monotonicMs)
  }

  /** Execute one non-CDP query through the active source generation. */
  request<Query extends InspectorQuery>(query: Query): Promise<InspectorQueryResultFor<Query>> {
    return this.queries.request(query)
  }
}
