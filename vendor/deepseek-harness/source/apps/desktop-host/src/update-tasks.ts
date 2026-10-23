/** Desktop installation admission and task inspection for the shared Web Host. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-client-connection'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Product-owned work; a Desktop product must provide an authoritative inspector. */
    'desktop/active-tasks'(next: () => Promise<boolean>): Promise<boolean>
  }
}

/**
 * Read product work and unowned background jobs without requiring Agent sessions.
 * @param ctx - Desktop Host context with a product inspector and Jobs service.
 * @returns true when the product reports work or a global job is running or stopping.
 * @throws when an owner is unavailable or cannot inspect its current state.
 */
export async function hasDesktopActiveTasks(ctx: Context): Promise<boolean> {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) throw new Error('desktop activity: jobs service is unavailable')
  const active = await ctx.waterfall('desktop/active-tasks', () => Promise.reject(new Error('desktop activity: product inspector is unavailable')))
  return active || jobs.list().some(job => job.status === 'running' || job.status === 'stopping')
}

/**
 * Register update admission on the owning Host context.
 * @param ctx - Booted Desktop profile context; disposal removes the request listener.
 * @returns Task inspector whose lock refuses new API requests, drains admitted requests, and rechecks work.
 */
export function installDesktopUpdateTaskControl(ctx: Context): (action: 'inspect' | 'lock' | 'unlock') => Promise<boolean> {
  let locked = false
  let lockGeneration = 0
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  const pendingRequests = new Set<Promise<void>>()
  ctx.on('connection/request', async (_request, response, next) => {
    if (locked) {
      response.writeHead(503)
      response.end()
      return
    }
    const finished = Promise.withResolvers<void>()
    pendingRequests.add(finished.promise)
    try { await next() }
    finally { pendingRequests.delete(finished.promise); finished.resolve() }
  })
  return async (action) => {
    if (stopped) throw new Error('desktop update: Host is stopping')
    if (action === 'unlock') { locked = false; lockGeneration++ }
    if (action === 'lock') {
      locked = true
      const generation = ++lockGeneration
      // Read requests are not tasks; admitted writes must finish before the final work check.
      await Promise.all(pendingRequests)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Disposal can run while admitted requests drain.
      if (stopped) throw new Error('desktop update: Host is stopping')
      if (generation !== lockGeneration) throw new Error('desktop update: admission lock was superseded')
    }
    return hasDesktopActiveTasks(ctx)
  }
}
