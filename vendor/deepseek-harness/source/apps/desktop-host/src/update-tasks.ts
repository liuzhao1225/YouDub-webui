/** Desktop installation admission and task inspection for the shared Web Host. */

import type { Context } from '@deepseek-ai/cordis'
import { hasDesktopActiveTasks } from './quit-inspection.ts'
import type {} from '@deepseek-ai/dsh-client-connection'

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
