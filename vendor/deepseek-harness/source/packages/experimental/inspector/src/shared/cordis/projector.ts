/** Pure projection from routed Cordis snapshots to the consumer-neutral tree. */

import type { CordisTreeNode, CordisTreeSnapshot } from './snapshot.ts'
import {
  CORDIS_RUNTIME_TREE_SCHEMA_VERSION,
  cordisRuntimeSourceId,
  type CordisRuntimeContext,
  type CordisRuntimeNode,
  type CordisRuntimeSourceKind,
  type CordisRuntimeTree,
} from './model.ts'

/** Whether a retained routed snapshot still has a live source generation. */
export type CordisTreeSourceConnection =
  | { readonly state: 'connected' }
  | { readonly state: 'disconnected'; readonly reason: string }

/** One source generation and its latest routed Cordis snapshot. */
export interface CordisTreeSource {
  readonly sourceId: string
  readonly kind: CordisRuntimeSourceKind
  readonly label: string
}

/** One source generation and its latest routed Cordis snapshot. */
export interface CordisTreeSourceSnapshot<Source extends CordisTreeSource = CordisTreeSource> {
  readonly source: Source
  readonly snapshot: CordisTreeSnapshot
  readonly connection: CordisTreeSourceConnection
}

/** Routed Host and Client snapshots before consumer-neutral projection. */
export interface CordisInspectionTree<Source extends CordisTreeSource = CordisTreeSource> {
  readonly host: CordisTreeSourceSnapshot<Source> | null
  readonly clients: readonly CordisTreeSourceSnapshot<Source>[]
}

/**
 * Strip transport and live-object routing fields from retained Cordis snapshots.
 * @param tree - Worker-owned routed snapshots.
 * @returns A detached semantic tree safe for non-CDP consumers.
 */
export function projectCordisRuntimeTree<Source extends CordisTreeSource>(tree: CordisInspectionTree<Source>): CordisRuntimeTree {
  return {
    schemaVersion: CORDIS_RUNTIME_TREE_SCHEMA_VERSION,
    host: tree.host === null ? null : projectRealm(tree.host),
    clients: tree.clients.map(projectRealm),
  }
}

function projectRealm(realm: CordisTreeSourceSnapshot): CordisRuntimeTree['clients'][number] {
  return {
    source: {
      sourceId: cordisRuntimeSourceId(realm.source.sourceId),
      kind: realm.source.kind,
      label: realm.source.label,
    },
    connection: realm.connection.state === 'connected'
      ? { state: 'connected' }
      : { state: 'disconnected', reason: realm.connection.reason },
    revision: realm.snapshot.revision,
    truncated: realm.snapshot.truncated,
    root: projectContext(realm.snapshot.root),
  }
}

function projectContext(node: Extract<CordisTreeNode, { kind: 'context' }>): CordisRuntimeContext {
  return { kind: 'context', children: node.children.map(projectNode) }
}

function projectNode(node: CordisTreeNode): CordisRuntimeNode {
  if (node.kind === 'context') return projectContext(node)
  return {
    kind: 'fiber',
    uid: node.uid,
    children: [projectContext(node.children[0])],
  }
}
