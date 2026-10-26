/** Background job lifecycle service; producers own execution and output. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { JobSpec } from './types.ts'

export type { JobHooks, JobOutcome, JobSpec } from './types.ts'

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
 * - Settlement is first-wins, even against a late producer outcome.
 * - Settled jobs release their registry records.
 * - {@link start} refuses work without an attached job controller, so work
 *   remains covered by service teardown.
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
   * rejection leaves no execution resource. A throwing starter
   * leaves nothing registered; after it returns, registration cannot fail.
   * @param spec - diagnostic label and synchronous starter.
   */
  abstract start(spec: JobSpec): void

  /** Whether any producer is still running or finishing cancellation. */
  abstract hasActiveJobs(): boolean

  /**
   * Attach an effect-scoped controller that admits jobs into the registry.
   * @param name - diagnostic label; duplicate names remain independent.
   * @returns disposer that detaches this controller.
   */
  abstract attachController(name: string): () => void
}

export default JobRegistry
