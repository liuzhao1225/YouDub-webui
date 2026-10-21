/** Opaque identifiers owned by the cross-realm Inspector bridge. */

import type { InspectorId } from '../identity.ts'

export { inspectorId } from '../identity.ts'
export type { InspectorId } from '../identity.ts'

/** Stable identity of one logical observation source. */
export type InspectorSourceId = InspectorId<'InspectorSourceId'>

/** Identity of one source connection generation. */
export type InspectorSourceGeneration = InspectorId<'InspectorSourceGeneration'>

/** Identity of one DevTools connection's Client Runtime state. */
export type ClientRuntimeSessionId = InspectorId<'ClientRuntimeSessionId'>

/** Identity of one in-flight Worker-to-Client Runtime operation. */
export type ClientRuntimeRequestId = InspectorId<'ClientRuntimeRequestId'>

/** Identity of one DevTools connection's Client source catalog session. */
export type ClientSourceSessionId = InspectorId<'ClientSourceSessionId'>

/** Identity of one in-flight Worker-to-Client source operation. */
export type ClientSourceRequestId = InspectorId<'ClientSourceRequestId'>

/** Opaque reference to an object retained inside one Client Runtime session. */
export type ClientRemoteObjectHandle = InspectorId<'ClientRemoteObjectHandle'>
