/** Background job lifecycle service; producers own execution and output. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { JobId, JobSpec, JobView } from './types.ts'

export { JobId } from './types.ts'
export type { JobHandle, JobHooks, JobKind, JobOutcome, JobSpec, JobStatus, JobView } from './types.ts'

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
 * - Settlement is first-wins: one terminal record, released waiters, even against a late producer outcome.
 * - A settled record stays listed until service disposal or explicit removal.
 * - {@link start} refuses work without an attached job controller, so work
 *   can always be collected or stopped.
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

  /**
   * Preflight validation and controller availability before starting and
   * atomically registering work. Any preflight
   * rejection leaves no job id or execution resource. A throwing starter
   * leaves nothing registered; after it returns, registration cannot fail.
   * @param spec - job identity and synchronous starter.
   * @returns the registry-issued `<kind>-<short-uuid>` id.
   */
  abstract start(spec: JobSpec): JobId

  /**
   * List jobs in registration order.
   * @returns fresh projections.
   */
  abstract list(): JobView[]

  /**
   * Project one job by id. Throws for an unknown job.
   * @param id - job to look up.
   * @returns a fresh projection.
   */
  abstract get(id: JobId): JobView

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
   * Drop one settled job's record from the visible set. For a caller that collected the terminal state through its own
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
