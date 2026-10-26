/** Quit-time inspection of product work and background jobs for the Electron shell. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-jobs'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Product-owned work; a Desktop product must provide an authoritative inspector. */
    'desktop/active-tasks'(next: () => Promise<boolean>): Promise<boolean>
  }
}

/** Read product work and background jobs without starting or stopping tasks. */
async function hasDesktopActiveTasks(ctx: Context): Promise<boolean> {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) throw new Error('desktop activity: jobs service is unavailable')
  const active = await ctx.waterfall('desktop/active-tasks', () => Promise.reject(new Error('desktop activity: product inspector is unavailable')))
  return active || jobs.list().some(job => job.status === 'running' || job.status === 'stopping')
}

/** What quitting the Host now would affect. */
export interface DesktopQuitInspection {
  /** Product work and live background jobs. */
  readonly activeTasks: boolean
}

/**
 * Register the quit inspector on the owning Host context.
 * @param ctx - Booted Desktop profile context; disposal makes the inspector reject.
 * @returns Inspector using the product's current work state and Jobs service.
 */
export function installDesktopQuitInspection(ctx: Context): () => Promise<DesktopQuitInspection> {
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  return async () => {
    if (stopped) throw new Error('desktop quit: Host is stopping')
    return { activeTasks: await hasDesktopActiveTasks(ctx) }
  }
}
