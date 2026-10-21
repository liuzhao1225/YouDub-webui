/** Quit-time inspection of product work and background jobs for the Electron shell. */

import type { Context } from '@deepseek-ai/cordis'
import { hasDesktopActiveTasks } from './update-tasks.ts'

/** What quitting the Host now would affect. */
export interface DesktopQuitInspection {
  /** Product work and live jobs counted by the shared update-restart check. */
  readonly activeTasks: boolean
  /** Reserved by the existing Desktop IPC protocol; YouDub schedules no reminders. */
  readonly scheduledTasks: false
}

/**
 * Register the quit inspector on the owning Host context.
 * @param ctx - Booted Desktop profile context; disposal makes the inspector reject.
 * @returns Inspector using the product's current work state and Harness Jobs.
 */
export function installDesktopQuitInspection(ctx: Context): () => Promise<DesktopQuitInspection> {
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  return async () => {
    if (stopped) throw new Error('desktop quit: Host is stopping')
    return { activeTasks: await hasDesktopActiveTasks(ctx), scheduledTasks: false }
  }
}
