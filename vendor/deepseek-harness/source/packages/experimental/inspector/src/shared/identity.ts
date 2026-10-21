/** Shared branded-identifier construction without assigning protocol ownership. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** String branded with one Inspector identity role. */
export type InspectorId<Role extends string> = Branded<Role>

/**
 * Validate and brand a non-empty identifier received from or sent across a runtime boundary.
 * @param value - Untrusted identifier text.
 * @param label - Field name used in validation errors.
 * @returns The role-branded identifier.
 */
export function inspectorId<Role extends string>(value: string, label: string): InspectorId<Role> {
  if (value.length === 0 || value.length > 256) {
    throw new Error(`inspector protocol: ${label} must contain 1 to 256 characters`)
  }
  return value as InspectorId<Role>
}
