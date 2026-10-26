/** Producer and lifecycle contracts for process-local background jobs. */
/** Settles after the producer releases its resources. */
export interface JobOutcome {
  status: 'completed' | 'killed' | 'failed'
  /** Producer-reported terminal reason. */
  detail?: string
}

export interface JobHooks {
  /** Must eventually settle done; synchronous failures propagate. */
  cancel(reason?: string): void
  /** Rejections and failed outcomes are reported before releasing the job. */
  done: Promise<JobOutcome>
}

export interface JobSpec {
  /** Diagnostic label identifying a failed producer or cancellation. */
  label: string
  /** A throwing starter leaves no registered job and owns its cleanup. */
  run(): JobHooks
}
