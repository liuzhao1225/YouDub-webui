/** CDP-independent snapshot model for a Cordis Context and Fiber tree. */

import {
  type InspectorObjectHandle,
  type InspectorObjectRegistryId,
} from './ids.ts'
import { isPlainObject } from '../json.ts'
import { exactKeys, exactObject, wireId } from '../validation.ts'

/** Current serialized Cordis tree model version. */
export const CORDIS_TREE_SCHEMA_VERSION = 0 as const

/** Maximum nesting accepted from one realm snapshot. */
export const CORDIS_TREE_MAX_DEPTH = 256

interface CordisTreeNodeBase {
  readonly objectHandle: InspectorObjectHandle
}

/** One Context entity in a Cordis tree snapshot. */
export interface CordisContextTreeNode extends CordisTreeNodeBase {
  readonly kind: 'context'
  readonly children: readonly CordisTreeNode[]
}

/** One Fiber entity in a Cordis tree snapshot. */
export interface CordisFiberTreeNode extends CordisTreeNodeBase {
  readonly kind: 'fiber'
  readonly uid: number
  readonly children: readonly [CordisContextTreeNode]
}

/** One semantic entity node in preorder. */
export type CordisTreeNode = CordisContextTreeNode | CordisFiberTreeNode

/** Immutable, serializable state of one realm's reachable Cordis tree. */
export interface CordisTreeSnapshot {
  readonly schemaVersion: typeof CORDIS_TREE_SCHEMA_VERSION
  readonly revision: number
  readonly objectRegistryId: InspectorObjectRegistryId
  readonly root: CordisContextTreeNode
  readonly truncated: boolean
}

/**
 * Decode and validate one complete Cordis tree replacement.
 * @param value - Untrusted observation payload.
 * @param maxNodes - Maximum nodes admitted from one source.
 * @returns A detached, validated snapshot.
 */
export function parseCordisTreeSnapshot(value: unknown, maxNodes: number): CordisTreeSnapshot {
  const record = exactObject(value, [
    'schemaVersion', 'revision', 'objectRegistryId', 'root', 'truncated',
  ], 'Cordis tree')
  if (record.schemaVersion !== CORDIS_TREE_SCHEMA_VERSION
    || !Number.isSafeInteger(record.revision) || (record.revision as number) < 1
    || typeof record.truncated !== 'boolean') {
    throw new Error('inspector protocol: invalid Cordis tree header')
  }
  const state: ParseState = { count: 0, handles: new Set(), fiberUids: new Set() }
  const root = parseNode(record.root, state, maxNodes, 0)
  if (root.kind !== 'context') throw new Error('inspector protocol: Cordis tree root must be a Context')
  return {
    schemaVersion: CORDIS_TREE_SCHEMA_VERSION,
    revision: record.revision as number,
    objectRegistryId: wireId<'InspectorObjectRegistryId'>(record.objectRegistryId, 'objectRegistryId'),
    root,
    truncated: record.truncated,
  }
}

interface ParseState {
  count: number
  readonly handles: Set<InspectorObjectHandle>
  readonly fiberUids: Set<number>
}

function parseNode(value: unknown, state: ParseState, maxNodes: number, depth: number): CordisTreeNode {
  if (depth > CORDIS_TREE_MAX_DEPTH) throw new Error('inspector protocol: Cordis tree exceeds the depth limit')
  if (++state.count > maxNodes) throw new Error(`inspector protocol: Cordis tree exceeds ${String(maxNodes)} nodes`)
  if (!isPlainObject(value) || (value.kind !== 'context' && value.kind !== 'fiber')) {
    throw new Error('inspector protocol: Cordis tree node must have a known kind')
  }
  const objectHandle = wireId<'InspectorObjectHandle'>(value.objectHandle, 'objectHandle')
  if (state.handles.has(objectHandle)) throw new Error('inspector protocol: Cordis tree repeats an object handle')
  state.handles.add(objectHandle)
  if (!Array.isArray(value.children)) throw new Error('inspector protocol: Cordis tree node children must be an array')
  if (value.kind === 'context') {
    exactKeys(value, ['kind', 'objectHandle', 'children'], 'Context tree node')
    return {
      kind: 'context',
      objectHandle,
      children: value.children.map(child => parseNode(child, state, maxNodes, depth + 1)),
    }
  }
  exactKeys(value, ['kind', 'objectHandle', 'uid', 'children'], 'Fiber tree node')
  if (!Number.isSafeInteger(value.uid) || (value.uid as number) < 1) {
    throw new Error('inspector protocol: Cordis Fiber uid must be a positive safe integer')
  }
  if (state.fiberUids.has(value.uid as number)) throw new Error('inspector protocol: Cordis tree repeats a Fiber uid')
  state.fiberUids.add(value.uid as number)
  if (value.children.length !== 1) throw new Error('inspector protocol: Cordis Fiber must own exactly one Context')
  const context = parseNode(value.children[0], state, maxNodes, depth + 1)
  if (context.kind !== 'context') throw new Error('inspector protocol: Cordis Fiber child must be a Context')
  return {
    kind: 'fiber',
    objectHandle,
    uid: value.uid as number,
    children: [context],
  }
}
