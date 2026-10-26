/** Producer and lifecycle contracts for process-local background jobs. */
import type { JobId } from './brand.ts'
import type { JobKind } from './view.ts'

export { JobId } from './brand.ts'
export type { JobKind, JobStatus, JobView } from './view.ts'

/** Settles after the producer releases its resources. */
export interface JobOutcome {
  status: 'completed' | 'killed' | 'failed'
  /** Producer-reported terminal reason. */
  detail?: string
}

export interface JobHandle {
  readonly id: JobId
  /** Updates live progress; settlement clears it. */
  updateProgress(line: string): void
}

export interface JobHooks {
  /** Must eventually settle done; synchronous failures propagate. */
  cancel(reason?: string): void
  /** Rejections are reported and recorded as failed jobs. */
  done: Promise<JobOutcome>
}

export interface JobSpec {
  kind: JobKind
  label: string
  /** A throwing starter leaves no registered job and owns its cleanup. */
  run(job: JobHandle): JobHooks
}
