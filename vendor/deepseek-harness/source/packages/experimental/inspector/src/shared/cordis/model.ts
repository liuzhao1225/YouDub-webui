/** Consumer-neutral Cordis runtime tree shared by non-CDP readers. */

import { CORDIS_TREE_MAX_DEPTH } from './snapshot.ts'
import { inspectorId, type InspectorId } from '../identity.ts'
import { isPlainObject } from '../json.ts'
import { exactKeys, exactObject, wireId } from '../validation.ts'

/** Current consumer-neutral Cordis tree version. */
export const CORDIS_RUNTIME_TREE_SCHEMA_VERSION = 0 as const

/** Consumer-visible identity of one inspected Cordis runtime. */
export type CordisRuntimeSourceId = InspectorId<'CordisRuntimeSourceId'>

/** Execution environment represented by one consumer-visible Cordis runtime. */
export type CordisRuntimeSourceKind = 'host' | 'client'

/** Availability of the realm represented by a retained tree. */
export type CordisRuntimeConnection =
  | { readonly state: 'connected' }
  | { readonly state: 'disconnected'; readonly reason: string }

/** Consumer-visible identity of one Cordis realm. */
export interface CordisRuntimeSource {
  readonly sourceId: CordisRuntimeSourceId
  readonly kind: CordisRuntimeSourceKind
  readonly label: string
}

/** One Context in a consumer-neutral Cordis tree. */
export interface CordisRuntimeContext {
  readonly kind: 'context'
  readonly children: readonly CordisRuntimeNode[]
}

/** One Fiber and its owned Context in a consumer-neutral Cordis tree. */
export interface CordisRuntimeFiber {
  readonly kind: 'fiber'
  readonly uid: number
  readonly children: readonly [CordisRuntimeContext]
}

/** One semantic Cordis runtime node. */
export type CordisRuntimeNode = CordisRuntimeContext | CordisRuntimeFiber

/** Latest retained topology and availability of one Cordis realm. */
export interface CordisRuntimeRealm {
  readonly source: CordisRuntimeSource
  readonly connection: CordisRuntimeConnection
  readonly revision: number
  readonly truncated: boolean
  readonly root: CordisRuntimeContext
}

/** Latest Host and Client Cordis topology without routing or CDP identifiers. */
export interface CordisRuntimeTree {
  readonly schemaVersion: typeof CORDIS_RUNTIME_TREE_SCHEMA_VERSION
  readonly host: CordisRuntimeRealm | null
  readonly clients: readonly CordisRuntimeRealm[]
}

/**
 * Decode a consumer-neutral tree received across an Inspector transport.
 * @param value - Untrusted query result value.
 * @returns A detached tree containing only public semantic fields.
 */
export function parseCordisRuntimeTree(value: unknown): CordisRuntimeTree {
  const record = exactObject(value, ['schemaVersion', 'host', 'clients'], 'Cordis runtime tree')
  if (record.schemaVersion !== CORDIS_RUNTIME_TREE_SCHEMA_VERSION || !Array.isArray(record.clients)) {
    throw new Error('inspector protocol: invalid Cordis runtime tree')
  }
  const host = record.host === null ? null : parseRealm(record.host, 'host')
  const clients = record.clients.map(client => parseRealm(client, 'client'))
  const sourceIds = new Set<CordisRuntimeSourceId>()
  for (const realm of host === null ? clients : [host, ...clients]) {
    if (sourceIds.has(realm.source.sourceId)) {
      throw new Error('inspector protocol: Cordis runtime tree repeats a sourceId')
    }
    sourceIds.add(realm.source.sourceId)
  }
  return {
    schemaVersion: CORDIS_RUNTIME_TREE_SCHEMA_VERSION,
    host,
    clients,
  }
}

function parseRealm(value: unknown, kind: CordisRuntimeSourceKind): CordisRuntimeRealm {
  const record = exactObject(value, ['source', 'connection', 'revision', 'truncated', 'root'], 'Cordis runtime realm')
  const source = exactObject(record.source, ['sourceId', 'kind', 'label'], 'Cordis runtime source')
  if (source.kind !== kind || typeof source.label !== 'string' || source.label.length === 0 || source.label.length > 256) {
    throw new Error(`inspector protocol: invalid ${kind} Cordis runtime source`)
  }
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1 || typeof record.truncated !== 'boolean') {
    throw new Error('inspector protocol: invalid Cordis runtime realm header')
  }
  const root = parseNode(record.root, { fiberUids: new Set() }, 0)
  if (root.kind !== 'context') throw new Error('inspector protocol: Cordis runtime root must be a Context')
  return {
    source: {
      sourceId: wireId<'CordisRuntimeSourceId'>(source.sourceId, 'sourceId'),
      kind,
      label: source.label,
    },
    connection: parseConnection(record.connection),
    revision: record.revision as number,
    truncated: record.truncated,
    root,
  }
}

/**
 * Project an inspected source id into the consumer-visible Cordis identity namespace.
 * @param value - Stable source id carried by the current runtime observation.
 * @returns The corresponding Cordis runtime source id.
 */
export function cordisRuntimeSourceId(value: string): CordisRuntimeSourceId {
  return inspectorId<'CordisRuntimeSourceId'>(value, 'sourceId')
}

function parseConnection(value: unknown): CordisRuntimeConnection {
  if (!isPlainObject(value)) throw new Error('inspector protocol: Cordis runtime connection must be an object')
  if (value.state === 'connected') {
    exactKeys(value, ['state'], 'connected Cordis runtime connection')
    return { state: 'connected' }
  }
  if (value.state === 'disconnected' && typeof value.reason === 'string') {
    exactKeys(value, ['state', 'reason'], 'disconnected Cordis runtime connection')
    return { state: 'disconnected', reason: value.reason }
  }
  throw new Error('inspector protocol: invalid Cordis runtime connection')
}

interface ParseState {
  readonly fiberUids: Set<number>
}

function parseNode(value: unknown, state: ParseState, depth: number): CordisRuntimeNode {
  if (depth > CORDIS_TREE_MAX_DEPTH) throw new Error('inspector protocol: Cordis runtime tree exceeds the depth limit')
  if (!isPlainObject(value) || (value.kind !== 'context' && value.kind !== 'fiber')) {
    throw new Error('inspector protocol: Cordis runtime node must have a known kind')
  }
  const record = exactObject(value, value.kind === 'fiber'
    ? ['kind', 'uid', 'children']
    : ['kind', 'children'], 'Cordis runtime node')
  if (!Array.isArray(record.children)) throw new Error('inspector protocol: Cordis runtime node children must be an array')
  if (record.kind === 'context') {
    return { kind: 'context', children: record.children.map(child => parseNode(child, state, depth + 1)) }
  }
  if (!Number.isSafeInteger(record.uid)
    || (record.uid as number) < 1
    || record.children.length !== 1) {
    throw new Error('inspector protocol: invalid Cordis runtime Fiber')
  }
  const uid = record.uid as number
  if (state.fiberUids.has(uid)) throw new Error('inspector protocol: Cordis runtime tree repeats a Fiber uid')
  state.fiberUids.add(uid)
  const context = parseNode(record.children[0], state, depth + 1)
  if (context.kind !== 'context') throw new Error('inspector protocol: Cordis runtime Fiber child must be a Context')
  return { kind: 'fiber', uid, children: [context] }
}
