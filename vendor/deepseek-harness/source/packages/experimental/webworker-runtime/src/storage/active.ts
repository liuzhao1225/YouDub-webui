/**
 * Process-wide slot holding the mounted filesystem. Kept apart from any
 * backend implementation: the `node:fs` proxy depends on the slot, not on
 * which backend the worker entry mounted.
 * @module @deepseek-ai/dsh-experimental-webworker-runtime/src/storage/active
 */
import type { Vfs } from './types.ts'

let active: Vfs | undefined

/**
 * Publish the filesystem the `node:fs` proxy reads.
 * @param vfs - Filesystem mounted by the worker entry.
 */
export function setActiveVfs(vfs: Vfs): void {
  active = vfs
}

/**
 * Read the mounted filesystem.
 * @returns The active filesystem.
 */
export function requireActiveVfs(): Vfs {
  if (active === undefined) {
    throw new Error('webworker vfs: no filesystem is mounted; the worker entry must call setActiveVfs before any node:fs access')
  }
  return active
}
