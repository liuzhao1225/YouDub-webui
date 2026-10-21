/** Environment-independent Cordis runtime tree reader. */

import type { CordisRuntimeTree } from './model.ts'

/** Read-only access to the latest committed consumer-neutral Cordis tree. */
export interface CordisRuntimeTreeReader {
  /**
   * Read the latest Worker snapshot without activating CDP domains.
   * @returns A detached Host and Client Cordis tree.
   * @throws When the source transport is unavailable, closes, times out, or rejects the query.
   */
  getTree(): Promise<CordisRuntimeTree>
}

/**
 * Create a reader around a local committed-tree projection.
 * @param read - Synchronous or asynchronous latest-tree read.
 * @returns A reader suitable for query and CDP adapters.
 */
export function createCordisRuntimeTreeReader(
  read: () => CordisRuntimeTree | Promise<CordisRuntimeTree>,
): CordisRuntimeTreeReader {
  return { getTree: async () => await read() }
}
