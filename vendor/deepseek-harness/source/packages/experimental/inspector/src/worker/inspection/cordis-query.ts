/** Cordis tree query execution independent of its source carrier. */

import type { CordisRuntimeTreeReader } from '../../shared/cordis/reader.ts'
import type { InspectorQuery, InspectorQueryResult } from '../../shared/bridge/messages/query/commands.ts'

/**
 * Execute one closed Inspector query against the shared semantic reader.
 * @param reader - Latest committed Cordis tree reader.
 * @param query - Validated query command.
 * @returns The result corresponding to the query operation.
 */
export async function executeInspectorQuery(
  reader: CordisRuntimeTreeReader,
  query: InspectorQuery,
): Promise<InspectorQueryResult> {
  return { op: query.op, tree: await reader.getTree() }
}
