/** Query-backed adapter for the transport-independent Cordis tree reader. */

import type { CordisRuntimeTreeReader } from '../cordis/reader.ts'
import type { InspectorQueryRequester } from './messages/query/commands.ts'

/**
 * Create a reader that obtains the tree through the typed Inspector query protocol.
 * @param requester - Active Host or Client query connection.
 * @returns A non-CDP Cordis tree reader.
 */
export function createQueryCordisRuntimeTreeReader(requester: InspectorQueryRequester): CordisRuntimeTreeReader {
  return {
    async getTree() {
      const result = await requester.request({ op: 'cordis-tree/get' })
      return result.tree
    },
  }
}
