/** Versioned frames for source-to-Worker non-CDP queries. */

import type { InspectorId, InspectorSourceGeneration, InspectorSourceId } from '../../ids.ts'
import { INSPECTOR_PROTOCOL_VERSION } from '../../version.ts'
import type { InspectorQuery, InspectorQueryError, InspectorQueryResult } from './commands.ts'

/** Identity of one in-flight Inspector query. */
export type InspectorQueryRequestId = InspectorId<'InspectorQueryRequestId'>

/** Source request for one Worker-owned query operation. */
export interface InspectorQueryRequestFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'query/request'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly requestId: InspectorQueryRequestId
  readonly query: InspectorQuery
}

/** Worker response correlated to one source query request. */
export interface InspectorQueryResponseFrame {
  readonly v: typeof INSPECTOR_PROTOCOL_VERSION
  readonly t: 'query/response'
  readonly sourceId: InspectorSourceId
  readonly generation: InspectorSourceGeneration
  readonly requestId: InspectorQueryRequestId
  readonly outcome:
    | { readonly ok: true; readonly result: InspectorQueryResult }
    | { readonly ok: false; readonly error: InspectorQueryError }
}
