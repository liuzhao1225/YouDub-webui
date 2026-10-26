/** In-memory job lifecycle registry with scoped controllers and cancellation. */

import { Context } from '@deepseek-ai/cordis'
import { JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { JobSpec } from '@deepseek-ai/dsh-jobs'

interface TrackedJob {
  label: string
  cancel: (reason?: string) => void
  settled: Promise<void>
  markSettled: () => void
}

/** Tracks live producers until their resources are released. */
export class LocalJobRegistry extends JobRegistry {
  private readonly active = new Set<TrackedJob>()
  private readonly controllers = new Set<symbol>()
  /** Detached settlement and teardown use the service's own context. */
  private readonly selfCtx: Context

  constructor(ctx: Context) {
    super(ctx)
    this.selfCtx = ctx
    ctx.effect(() => () => this.disposeAll(), 'jobs teardown')
  }

  start(spec: JobSpec): void {
    if (Object.hasOwn(spec, 'output')) throw new Error('job output sources are no longer supported')
    if (this.controllers.size === 0) {
      throw new Error('background jobs unavailable: no job controller attached')
    }
    if (spec.label.length === 0) throw new Error('invalid job label: expected a non-empty string')
    const hooks = spec.run()
    const { promise: settled, resolve: markSettled } = Promise.withResolvers<void>()
    const job: TrackedJob = { label: spec.label, cancel: hooks.cancel.bind(hooks), settled, markSettled }
    this.active.add(job)
    void hooks.done.then(outcome => {
      if (outcome.status === 'failed') {
        this.selfCtx.logger.warn(`jobs: ${job.label} failed: ${outcome.detail ?? 'producer reported failure'}`)
      }
      this.settle(job)
    }, (error: unknown) => {
      this.selfCtx.logger.warn(`jobs: ${job.label} producer done promise rejected (producer contract violation): ${String(error)}`)
      this.settle(job)
    })
  }

  hasActiveJobs(): boolean {
    return this.active.size > 0
  }

  attachController(name: string): () => void {
    // One token per call keeps duplicate labels independently disposable.
    const token = Symbol(name)
    const dispose = this.ctx.effect(() => {
      this.controllers.add(token)
      return () => { this.controllers.delete(token) }
    }, 'jobs.attachController()')
    // oxlint-disable-next-line typescript/no-misused-promises -- exact synchronous disposer preserves Cordis effect identity
    return dispose
  }

  private settle(job: TrackedJob): void {
    if (this.active.delete(job)) job.markSettled()
  }

  /** Cancel live work and await settlement; throwing cancels remain visible. */
  private async disposeAll(): Promise<void> {
    const active = [...this.active]
    for (const job of active) {
      try {
        job.cancel('jobs service disposed')
      } catch (error: unknown) {
        this.selfCtx.logger.warn(`jobs: cancel of ${job.label} threw during teardown; work may be orphaned: ${String(error)}`)
        this.settle(job)
      }
    }
    await Promise.all(active.map(job => job.settled))
  }
}

export default LocalJobRegistry
