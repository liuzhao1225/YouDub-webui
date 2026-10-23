/** Baseline-and-delta protocol layered over a reconnecting Remote stream. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteStream } from './remote-stream.ts'

/** Host-side stream protocol violation, marked so consumers surface it as an error state. */
function protocolViolation(message: string): RemoteError<'gateway/internal'> {
  return new RemoteError('gateway/internal', message, {})
}

/** Domain operations for one snapshot stream. */
export interface RemoteSnapshotStreamOptions<Snapshot, Delta> {
  /** Diagnostic stream name used in protocol failures. */
  readonly name: string
  /** Distinguish the opening snapshot from later deltas. */
  readonly isSnapshot: (value: Snapshot | Delta) => value is Snapshot
  /** Atomically replace the domain model from a complete snapshot. */
  readonly replace: (snapshot: Snapshot) => void
  /** Apply one incremental update after the generation snapshot. */
  readonly update: (delta: Delta) => void
  /** Publish a terminal business or protocol failure. */
  readonly failed: (error: unknown) => void
}

/**
 * Consumes generations that each contain exactly one opening snapshot followed by deltas.
 *
 * The previous domain snapshot remains published while the underlying stream retries. A
 * replacement becomes accepted only after the domain owner applies it successfully.
 */
export class RemoteSnapshotStream<Snapshot, Delta> {
  private started = false
  private disposed = false
  private done: Promise<void> | undefined

  /**
   * @param stream - reconnecting physical-generation stream.
   * @param options - frame discriminator and domain state destinations.
   */
  constructor(
    private readonly stream: RemoteStream<Snapshot | Delta>,
    private readonly options: RemoteSnapshotStreamOptions<Snapshot, Delta>,
  ) {}

  /** Start the single consumer; repeated calls are inert. */
  start(): void {
    if (this.started) return
    this.started = true
    this.done = this.consume()
  }

  /** Replace the active physical generation without discarding the published snapshot. */
  restart(): void {
    this.stream.restart()
  }

  /**
   * Permanently stop the stream and wait for its consumer to become quiescent.
   * @returns when no generation or callback can still run.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.stream.dispose()
    await this.done
  }

  private async consume(): Promise<void> {
    let generation = 0
    let snapshotSeen = false
    try {
      for await (const item of this.stream) {
        if (item.generation !== generation) {
          generation = item.generation
          snapshotSeen = false
        }
        if (this.options.isSnapshot(item.value)) {
          if (snapshotSeen) {
            throw protocolViolation(`${this.options.name} emitted more than one opening snapshot`)
          }
          this.options.replace(item.value)
          snapshotSeen = true
          item.accept()
          continue
        }
        if (!snapshotSeen) {
          throw protocolViolation(`${this.options.name} emitted an update before its opening snapshot`)
        }
        this.options.update(item.value)
      }
    } catch (error) {
      if (!this.disposed) this.options.failed(error)
    }
  }
}
