/**
 * The background-job Service Definition (`ctx.jobs`). It owns the contract for
 * job ids, lifecycle state, the per-job output ring —
 * one bounded stream that a consumer reads through a registry-kept cursor
 * and that any number of observers read at absolute byte offsets — and the
 * event stream announcing every commit, while producers retain their
 * execution resources. The process-local registry lives in
 * `@deepseek-ai/dsh-jobs-local`.
 * @module @deepseek-ai/dsh-jobs
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { JobEvents, JobId, JobOutputRead, JobRead, JobSpec, JobView } from './types.ts'

export { JobId } from './types.ts'
export type {
  JobAppendOptions,
  JobChannel,
  JobChunk,
  JobEvent,
  JobEventListener,
  JobEvents,
  JobHandle,
  JobHooks,
  JobKind,
  JobKindMap,
  JobOutcome,
  JobOutputRead,
  JobOutputSource,
  JobRead,
  JobSettleCause,
  JobSourceRead,
  JobSpec,
  JobStatus,
  JobView,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    jobs: JobRegistry
  }
}

/**
 * Abstract background job registry. Subclass, implement the abstract members,
 * and load the subclass as a plugin — it registers as `ctx.jobs` (one
 * implementation per context; loading a second throws, which is cordis'
 * standard duplicate-service behavior).
 *
 * Implementations must honor these semantics:
 * - Registrations outlive producer and controller fibers. Service disposal
 *   cancels live work and awaits compliant producers; a throwing teardown
 *   cancel force-fails only the record and reports possible orphaned work.
 * - Settlement is first-wins: one terminal record, released waiters, then one
 *   round of contained event delivery, even against a late producer outcome.
 * - A settled record stays listed until service disposal or explicit removal.
 * - {@link start} refuses work without an attached job controller, so work
 *   can always be collected or stopped.
 * - Every job owns one output ring. Pull sources named by the spec are pumped
 *   by the registry and drained once more before settlement; pushed appends
 *   land whole. The consuming cursor and observers' absolute offsets
 *   read the same bytes and never disturb each other.
 * - Ring retention is bounded. Appends past the live cap drop the oldest
 *   retained bytes; a reader below the retained window gets a lossy read,
 *   never an error. Settlement trims retention to the settled cap and ends
 *   the stream; the ring has no separate lifecycle.
 */
export abstract class JobRegistry extends Service {
  constructor(ctx: Context) {
    // `abstract` erases at runtime, so a composition row naming this package
    // would register a ctx.jobs with no method implementations and fail far
    // from the misconfiguration. Fail loud at load instead.
    if (new.target === JobRegistry) {
      throw new Error('@deepseek-ai/dsh-jobs is the abstract job registry seam; load an implementation such as @deepseek-ai/dsh-jobs-local instead')
    }
    super(ctx, 'jobs')
  }

  /** Lifecycle and output events. */
  abstract readonly events: JobEvents

  /**
   * Preflight validation and controller availability before starting and
   * atomically registering work. Any preflight
   * rejection leaves no job id or execution resource. A throwing starter
   * leaves nothing registered; after it returns, registration cannot fail.
   * @param spec - job identity, output sources, and synchronous starter.
   * @returns the registry-issued `<kind>-<short-uuid>` id.
   */
  abstract start(spec: JobSpec): JobId

  /**
   * List jobs in registration order.
   * @returns fresh projections.
   */
  abstract list(): JobView[]

  /**
   * Project one job without changing its cursor. Throws for an unknown job.
   * @param id - job to look up.
   * @returns a fresh projection.
   */
  abstract get(id: JobId): JobView

  /**
   * Consume the ring from the consuming cursor and advance it to the current
   * total. After settlement the first read also carries the producer's
   * result. Throws for an unknown job.
   * @param id - job to read.
   * @returns the chunks since the cursor, the lossy flag, the result once, and the post-read projection.
   */
  abstract read(id: JobId): JobRead

  /**
   * Read retained ring output without moving the consuming cursor. Resume with
   * a previous read's `next`; an offset inside a retained chunk returns the
   * whole chunk (its `at` may precede `from`). Throws for a negative or
   * non-integer offset, or an unknown job.
   * @param id - job to read.
   * @param from - absolute byte offset to read from (0 for the retained head).
   * @returns retained chunks overlapping `[from, total)`, the resume offset, and the lossy flag.
   */
  abstract readAt(id: JobId, from: number): JobOutputRead

  /**
   * Request cancellation, then mark the job stopping. A producer throw
   * propagates without changing job state. A supplied reason is merged into
   * terminal `detail` when the job settles `killed`. Throws for an unknown job.
   * @param id - job to cancel.
   * @param reason - cancellation reason forwarded verbatim to the producer.
   * @returns `requested` for live work, otherwise `already-finished`.
   */
  abstract kill(id: JobId, reason?: string): 'requested' | 'already-finished'

  /**
   * Wait for settlement or timeout without cancelling the job. Caller abort
   * rejects only while the job is live; after settlement the terminal
   * projection wins. Rejects for an invalid timeout or an unknown job.
   * @param id - job to wait for.
   * @param timeoutMs - positive finite wait bound in milliseconds.
   * @param signal - optional cancellation of the wait itself.
   * @returns projection at settlement or timeout.
   */
  abstract wait(id: JobId, timeoutMs: number, signal?: AbortSignal): Promise<JobView>

  /**
   * Drop one settled job's record from the visible set and announce
   * `removed`. For a caller that collected the terminal state through its own
   * {@link wait}. Throws for a live or unknown job.
   * @param id - settled job to drop.
   */
  abstract remove(id: JobId): void

  /**
   * Attach an effect-scoped controller that can read and stop jobs.
   * @param name - diagnostic label; duplicate names remain independent.
   * @returns disposer that detaches this controller.
   */
  abstract attachController(name: string): () => void
}

export default JobRegistry
