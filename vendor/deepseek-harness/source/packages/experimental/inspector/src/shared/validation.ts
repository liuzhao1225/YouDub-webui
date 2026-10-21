/** Shared exact-object readers for versioned Inspector wire protocols. */

import { inspectorId, type InspectorId } from './identity.ts'
import { isPlainObject } from './json.ts'

/**
 * Require a plain object containing only the listed fields.
 * @param value - Candidate object.
 * @param keys - Complete field allowlist.
 * @param label - Object name used in validation errors.
 * @returns The validated plain object.
 */
export function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`inspector protocol: ${label} must be an object`)
  exactKeys(value, keys, label)
  return value
}

/**
 * Reject fields outside one versioned object's declared field set.
 * @param value - Plain object being validated.
 * @param keys - Complete field allowlist.
 * @param label - Object name used in validation errors.
 */
export function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new Error(`inspector protocol: ${label} has unknown field ${JSON.stringify(String(key))}`)
    }
  }
}

/**
 * Read one non-empty opaque identifier.
 * @param value - Candidate identifier.
 * @param label - Field name used in validation errors.
 * @returns The role-branded identifier.
 */
export function wireId<Role extends string>(value: unknown, label: string): InspectorId<Role> {
  if (typeof value !== 'string') throw new Error(`inspector protocol: ${label} must be a string`)
  return inspectorId<Role>(value, label)
}

/**
 * Read one optional string field.
 * @param value - Object containing the field.
 * @param key - Field name.
 * @returns An empty object or the validated field.
 */
export function optionalString<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): { readonly [Property in Key]?: string } {
  const item = value[key]
  if (item === undefined) return {}
  if (typeof item !== 'string') throw new Error(`inspector protocol: ${key} must be a string`)
  return { [key]: item } as { readonly [Property in Key]?: string }
}

/**
 * Read one optional boolean field.
 * @param value - Object containing the field.
 * @param key - Field name.
 * @returns An empty object or the validated field.
 */
export function optionalBoolean<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): { readonly [Property in Key]?: boolean } {
  const item = value[key]
  if (item === undefined) return {}
  if (typeof item !== 'boolean') throw new Error(`inspector protocol: ${key} must be a boolean`)
  return { [key]: item } as { readonly [Property in Key]?: boolean }
}

/**
 * Read one optional non-negative finite number field.
 * @param value - Object containing the field.
 * @param key - Field name.
 * @returns An empty object or the validated field.
 */
export function optionalNonNegativeNumber<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): { readonly [Property in Key]?: number } {
  const item = value[key]
  if (item === undefined) return {}
  if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) {
    throw new Error(`inspector protocol: ${key} must be a non-negative finite number`)
  }
  return { [key]: item } as { readonly [Property in Key]?: number }
}
