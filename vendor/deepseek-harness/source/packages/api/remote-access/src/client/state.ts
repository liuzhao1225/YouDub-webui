/**
 * React-free Client access state: the latest `remoteAccess/follow` snapshot
 * and identity-stable boolean sources per global action.
 * @module @deepseek-ai/dsh-api-remote-access/src/client/state
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteAccessFrame, RemoteAccessGrant } from '../types.ts'

type AccessSnapshot =
  /** No baseline, or a non-owner snapshot stream failed: every answer is false. */
  | { readonly kind: 'closed' }
  | { readonly kind: 'owner' }
  | {
    readonly kind: 'granted'
    readonly global: ReadonlySet<string>
  }

const CLOSED: AccessSnapshot = Object.freeze({ kind: 'closed' })
const OWNER_SNAPSHOT: AccessSnapshot = Object.freeze({ kind: 'owner' })

/** The opening frame of a snapshot generation. */
export type Baseline = Extract<RemoteAccessFrame, { type: 'baseline' }>

/**
 * Validate the opening baseline an index injection row assigned to the page.
 * @param value - the injected global; `undefined` when the page carries none.
 * @returns the baseline, or `undefined` when none was injected.
 * @throws TypeError when the injected value is not a baseline frame.
 */
export function parseInjectedBaseline(value: unknown): Baseline | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || value['type'] !== 'baseline') throw new TypeError('remote access: the injected access snapshot is not a baseline frame')
  if (value['owner'] === true) return { type: 'baseline', owner: true }
  const grants = value['grants']
  if (value['owner'] !== false || !Array.isArray(grants) || !grants.every(isGrant)) {
    throw new TypeError('remote access: the injected access snapshot carries malformed grants')
  }
  return { type: 'baseline', owner: false, grants }
}

function isGrant(value: unknown): value is RemoteAccessGrant {
  if (!isRecord(value) || !isRecord(value['resource']) || value['resource']['kind'] !== 'global') return false
  const actions = value['actions']
  return Array.isArray(actions) && actions.every(action => typeof action === 'string')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Snapshot owner for one Client generation. Sources are cached per
 * action so Hook bindings keep their identity; each source
 * computes its boolean from the current snapshot.
 */
export class ClientAccessState {
  private snapshot: AccessSnapshot = CLOSED

  /** @param initial - the page's injected opening baseline; without one every answer is false until a baseline arrives. */
  constructor(initial?: Baseline) {
    if (initial !== undefined) this.replace(initial)
  }
  private readonly listeners = new Set<() => void>()
  private readonly sources = new Map<string, HostObservable<boolean>>()

  /**
   * Answer for one action on the global resource.
   * @param action - endpoint action the caller may invoke.
   * @returns identity-stable boolean source.
   */
  global(action: string): HostObservable<boolean> {
    return this.cached(action)
  }

  /**
   * Replace the snapshot from one generation's opening frame.
   * @param frame - owner or non-owner baseline.
   */
  replace(frame: Baseline): void {
    if (frame.owner) {
      this.publish(OWNER_SNAPSHOT)
      return
    }
    let global: ReadonlySet<string> = new Set()
    for (const { resource, actions } of frame.grants) {
      if (resource.kind === 'global') global = new Set(actions)
    }
    this.publish({ kind: 'granted', global })
  }

  /**
   * Apply one increment of the current generation.
   * @param frame - `upsert` or `remove`.
   */
  update(frame: Exclude<RemoteAccessFrame, { type: 'baseline' }>): void {
    const current = this.snapshot
    if (current.kind !== 'granted') return
    switch (frame.type) {
      case 'upsert':
        if (frame.grant.resource.kind === 'global') this.publish({ kind: 'granted', global: new Set(frame.grant.actions) })
        return
      case 'remove':
        if (frame.resource.kind === 'global') this.publish({ kind: 'granted', global: new Set() })
        return
      /* v8 ignore next -- the generated Remote codec validates this closed union. */
      default:
        return assertNever(frame)
    }
  }

  /** Whether the current snapshot is the owner's, whose answers never depend on the stream. */
  get owner(): boolean {
    return this.snapshot.kind === 'owner'
  }

  /** The stream failed terminally: the owner keeps every answer; a non-owner's answers become false. */
  unavailable(): void {
    if (this.snapshot.kind !== 'owner') this.publish(CLOSED)
  }

  private cached(action: string): HostObservable<boolean> {
    let source = this.sources.get(action)
    if (source === undefined) {
      source = {
        getSnapshot: () => answer(this.snapshot, action),
        subscribe: (listener) => {
          this.listeners.add(listener)
          return () => { this.listeners.delete(listener) }
        },
      }
      this.sources.set(action, source)
    }
    return source
  }

  private publish(next: AccessSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

function answer(snapshot: AccessSnapshot, action: string): boolean {
  switch (snapshot.kind) {
    case 'closed':
      return false
    case 'owner':
      return true
    case 'granted':
      return snapshot.global.has(action)
    /* v8 ignore next -- closed union. */
    default:
      return assertNever(snapshot)
  }
}

/* v8 ignore next 3 -- closed-union backstop. */
function assertNever(value: never): never {
  throw new Error(`unreachable access frame: ${JSON.stringify(value)}`)
}
