/**
 * Client-safe job vocabulary. This leaf reaches no Host package, so
 * browser programs and Remote wire types import it without pulling the
 * registry's Host declaration merges.
 * @module @deepseek-ai/dsh-jobs/view
 */

import type { JobId } from './brand.ts'

/**
 * Job lifecycle: `running`, optionally `stopping`, then exactly one terminal
 * status. Producer-specific facts belong in {@link JobView.progress} and
 * {@link JobView.detail}.
 */
export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

/** Producer-defined id namespace. */
export type JobKind = string

/**
 * Read-only projection of one job — a fresh object per call, never live
 * registry state. Desktop shutdown inspects the live statuses.
 */
export interface JobView {
  /** The registry-issued id (`<kind>-<short-uuid>`). */
  readonly id: JobId
  /**
   * The producer kind the job was registered with: a Host-registered
   * `JobKind`, carried as an open string because a browser bundle or a Remote
   * codec sees only the producer types its own program compiles.
   */
  readonly kind: string
  /** The producer-supplied one-line label. */
  readonly label: string
  /** Current lifecycle state. */
  readonly status: JobStatus
  /** The producer's live progress line (`3/10`, the current phase); cleared at settlement. */
  readonly progress?: string
  /** Producer-reported terminal reason (`exit code: 3`). */
  readonly detail?: string
  /** Epoch ms when the job was registered. */
  readonly startedAt: number
  /** Epoch ms when the job settled; absent while live. */
  readonly finishedAt?: number
}
