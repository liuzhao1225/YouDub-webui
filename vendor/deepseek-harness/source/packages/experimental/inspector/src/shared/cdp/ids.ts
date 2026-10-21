/** Opaque identifiers owned by normalized realm backends. */

import type { InspectorId } from '../identity.ts'

/** Worker identity of one active Host or Client realm incarnation. */
export type InspectorRealmId = InspectorId<'InspectorRealmId'>

/** Backend-owned object handle interpreted only by its realm session. */
export type RuntimeBackendObjectHandle = InspectorId<'RuntimeBackendObjectHandle'>

/** Backend-independent identity of one script in a realm catalog. */
export type RuntimeScriptKey = InspectorId<'RuntimeScriptKey'>
