/** In-memory job lifecycle registry with scoped controllers and cancellation. */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { JobRegistry, JobId } from '@deepseek-ai/dsh-jobs'
import type { JobHandle, JobKind, JobOutcome, JobSpec, JobStatus, JobView } from '@deepseek-ai/dsh-jobs'

/** Timeout code that distinguishes a bounded wait from caller cancellation. */
export const TASK_WAIT_TIMEOUT = 'TASK_WAIT_TIMEOUT'

/**
 * Producer-written state shared between the {@link JobHandle} and the
 * registered record: the starter call writes through it before the commit,
 * the same object serves the job for its whole life afterwards.
 */
interface ProducerState {
  /** Live progress line until settlement clears it. */
  progress: string | undefined
  /** The committed registry record; undefined exactly during the starter call. */
  job: TrackedJob | undefined
}

/** The registry's mutable per-job record (never handed out — see {@link LocalJobRegistry.view}). */
interface TrackedJob {
  id: JobId
  kind: JobKind
  label: string
  cancel: (reason?: string) => void
  status: JobStatus
  /** Producer-shared progress line and commit binding. */
  state: ProducerState
  /** Terminal reason; a recorded kill reason is merged in at settlement. */
  detail: string | undefined
  startedAt: number
  finishedAt: number | undefined
  /** Reason recorded by {@link JobRegistry.kill}, merged into a `killed` settlement's detail. */
  killReason: string | undefined
  /** Resolves once the terminal record is committed and announced. */
  settled: Promise<void>
  /** Resolver for {@link settled}, called by the first effective settlement. */
  markSettled: () => void
  /** Removable resolvers for live waits; timeout/abort unregister before the job settles. */
  waitResolvers: Set<() => void>

}

/** True for the three terminal {@link JobStatus} values. */
function isTerminal(status: JobStatus): boolean {
  return status === 'completed' || status === 'killed' || status === 'failed'
}

/**
 * The in-memory `jobs` registry. See the Service Definition contract in
 * `@deepseek-ai/dsh-jobs` for the lifecycle
 * semantics this implementation honors.
 */
export class LocalJobRegistry extends JobRegistry {
  private store = new Map<JobId, TrackedJob>()
  /** Independent controller registrations, disposed with their registering context. */
  private readonly controllers = new Set<symbol>()
  /** Service context used by detached settlement continuations and teardown. */
  private readonly selfCtx: Context

  constructor(ctx: Context) {
    super(ctx)
    this.selfCtx = ctx
    ctx.effect(() => () => this.disposeAll(), 'jobs teardown')
  }

  start(spec: JobSpec): JobId {
    if (Object.hasOwn(spec, 'output')) throw new Error('job output sources are no longer supported')
    if (this.controllers.size === 0) {
      throw new Error('background jobs unavailable: no job controller attached')
    }
    if (spec.kind.length === 0) throw new Error('invalid job kind: expected a non-empty string')
    if (spec.label.length === 0) throw new Error('invalid job label: expected a non-empty string')
    // The producer uses the same short UUID identity as controls and events.
    // Retry a collision while this registry still holds an earlier id.
    let id: JobId
    do {
      id = JobId(`${spec.kind}-${randomUUID().replaceAll('-', '').slice(0, 16)}`)
    } while (this.store.has(id))
    const state: ProducerState = { progress: undefined, job: undefined }
    const handle: JobHandle = {
      id,
      updateProgress: (line) => { this.updateProgress(state, line) },
    }
    const hooks = spec.run(handle)

    let markSettled!: () => void
    const settled = new Promise<void>((resolve) => { markSettled = resolve })
    const job: TrackedJob = {
      id,
      kind: spec.kind,
      label: spec.label,
      cancel: hooks.cancel.bind(hooks),
      status: 'running',
      state,
      detail: undefined,
      startedAt: Date.now(),
      finishedAt: undefined,
      killReason: undefined,
      settled,
      markSettled,
      waitResolvers: new Set(),
    }
    // Publish staged progress once the starter successfully returns.
    state.job = job
    this.store.set(id, job)
    const producerDone = hooks.done.catch((error: unknown): JobOutcome => {
      // Preserve contract violations as visible failed jobs; waiters still settle.
      this.selfCtx.logger.warn(`jobs: job ${job.id} producer done promise rejected (producer contract violation): ${String(error)}`)
      return { status: 'failed', detail: String(error) }
    })
    void producerDone.then(outcome => { this.settle(job, outcome) })
    return id
  }

  list(): JobView[] {
    return [...this.store.values()]
      .map(job => this.view(job))
  }

  get(id: JobId): JobView {
    return this.view(this.expect(id))
  }

  kill(id: JobId, reason?: string): 'requested' | 'already-finished' {
    return this.killJob(this.expect(id), reason)
  }

  async wait(id: JobId, timeoutMs: number, signal?: AbortSignal): Promise<JobView> {
    return this.waitJob(this.expect(id), timeoutMs, signal)
  }

  remove(id: JobId): void {
    const job = this.expect(id)
    if (!isTerminal(job.status)) throw new Error(`job ${id} is still ${job.status}; kill it and wait for settlement before removing it`)
    this.drop([job])
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

  /** Look up a registered job. */
  private expect(id: JobId): TrackedJob {
    const job = this.store.get(id)
    if (job === undefined) throw new Error(`unknown job ${id}`)
    return job
  }

  /** Project a fresh read-only view from the mutable record. */
  private view(job: TrackedJob): JobView {
    return {
      id: job.id,
      kind: job.kind,
      label: job.label,
      status: job.status,
      ...job.state.progress !== undefined ? { progress: job.state.progress } : {},
      ...job.detail !== undefined ? { detail: job.detail } : {},
      startedAt: job.startedAt,
      ...job.finishedAt !== undefined ? { finishedAt: job.finishedAt } : {},
    }
  }

  private killJob(job: TrackedJob, reason?: string): 'requested' | 'already-finished' {
    if (isTerminal(job.status)) return 'already-finished'
    // Cancel first so a throw leaves lifecycle state unchanged.
    job.cancel(reason)
    job.status = 'stopping'
    // Last writer wins on purpose: the detail reports the latest kill intent.
    if (reason !== undefined) job.killReason = reason
    return 'requested'
  }

  private async waitJob(job: TrackedJob, timeoutMs: number, signal?: AbortSignal): Promise<JobView> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`invalid wait timeout: expected a positive number of milliseconds, got ${JSON.stringify(timeoutMs)}`)
    }
    if (!isTerminal(job.status)) {
      if (signal?.aborted) throw new Error('wait aborted')
      // The scoped deadline distinguishes a successful wait timeout from
      // caller cancellation and clears its timer on every exit.
      using d = deadline(signal, timeoutMs, TASK_WAIT_TIMEOUT)
      await new Promise<void>((resolve, reject) => {
        const onSettled = (): void => {
          job.waitResolvers.delete(onSettled)
          d.signal.removeEventListener('abort', onAbort)
          resolve()
        }
        const onAbort = (): void => {
          job.waitResolvers.delete(onSettled)
          // A settled job cannot reach here: settlement releases every waiter
          // before it announces, and each released waiter detaches this
          // listener in the same synchronous span, so nothing that reacts to a
          // settlement can abort a wait the settlement already owed.
          if (timeoutOf(d.signal, TASK_WAIT_TIMEOUT) !== undefined) {
            resolve()
          } else {
            reject(new Error('wait aborted'))
          }
        }
        job.waitResolvers.add(onSettled)
        d.signal.addEventListener('abort', onAbort, { once: true })
      })
    }
    return this.view(job)
  }

  /**
   * Replace the live progress line through a producer face; a write against a
   * settled job is logged and dropped. A write staged inside the starter call
   * seeds the registered projection and signals no observer.
   */
  private updateProgress(state: ProducerState, line: string): void {
    const job = state.job
    if (job !== undefined && isTerminal(job.status)) {
      this.selfCtx.logger.warn(`jobs: progress update on settled job ${job.id} dropped`)
      return
    }
    state.progress = line
  }

  /** Commit the first terminal outcome before releasing waiters. */
  private settle(job: TrackedJob, outcome: JobOutcome): void {
    if (isTerminal(job.status)) return
    job.status = outcome.status
    // A killed settlement carries the recorded kill reason in its detail:
    // producer facts first (`signal: SIGTERM; cancelled by the user`). A job
    // that outran its kill request (settled `completed`/`failed`) keeps the
    // producer detail alone — the reason describes a kill that never landed.
    if (outcome.status === 'killed' && job.killReason !== undefined) {
      job.detail = outcome.detail !== undefined
        ? `${outcome.detail}; ${job.killReason}`
        : job.killReason
    } else if (outcome.detail !== undefined) {
      job.detail = outcome.detail
    }
    job.state.progress = undefined
    job.finishedAt = Date.now()
    const waitResolvers = [...job.waitResolvers]
    job.waitResolvers.clear()
    for (const resolveWait of waitResolvers) resolveWait()
    job.markSettled()

  }

  /** Drop settled records. */
  private drop(jobs: readonly TrackedJob[]): void {
    for (const job of jobs) {
      this.store.delete(job.id)
    }
  }

  /**
   * Cancel live jobs, await settlement, and drop every record.
   * Throwing cancels are force-failed to avoid teardown deadlock.
   */
  private async disposeAll(): Promise<void> {
    const all = [...this.store.values()]
    this.cancelForTeardown(all, 'jobs service disposed')
    await Promise.all(all.map(job => job.settled))
    this.drop(all)
  }

  /**
   * Cancel jobs during teardown with per-job containment. A throwing cancel
   * force-fails the record and reports a possible orphan; a cancel that returns
   * without settling remains indistinguishable from a slow stop and may stall.
   */
  private cancelForTeardown(jobs: TrackedJob[], reason: string): void {
    for (const job of jobs) {
      if (isTerminal(job.status)) continue
      try {
        job.cancel(reason)
        job.status = 'stopping'
      } catch (error: unknown) {
        const detail = `cancel threw during teardown; work may be orphaned: ${String(error)}`
        this.selfCtx.logger.warn(`jobs: cancel of ${job.id} threw during teardown; job record forced failed and work may be orphaned: ${String(error)}`)
        this.settle(job, { status: 'failed', detail })
      }
    }
  }
}

export default LocalJobRegistry
