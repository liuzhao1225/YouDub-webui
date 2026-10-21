/** Opaque identifiers owned by a realm-local Cordis object registry. */

import type { InspectorId } from '../identity.ts'

/** Identity of one realm-local table that retains objects named in a snapshot. */
export type InspectorObjectRegistryId = InspectorId<'InspectorObjectRegistryId'>

/** Opaque reference to one object retained by a realm-local registry. */
export type InspectorObjectHandle = InspectorId<'InspectorObjectHandle'>
