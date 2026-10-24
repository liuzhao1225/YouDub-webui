import { Context } from '@deepseek-ai/cordis'
import { JobId, JobRegistry } from '@deepseek-ai/dsh-jobs'
import type { JobStatus, JobView } from '@deepseek-ai/dsh-jobs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installDesktopQuitInspection } from '../src/quit-inspection.ts'
import type {} from '../src/update-tasks.ts'

let ctx: Context
let inspect: ReturnType<typeof installDesktopQuitInspection>
let productActive = false
let jobs: JobStatus[] = []
/** A registry whose only served member is the global roster the inspector reads. */
class RosterOnlyJobRegistry extends JobRegistry {
  readonly events = { subscribe: () => () => {} }
  start(): never { throw new Error('unsupported') }
  list(): JobView[] {
    return jobs.map((status, index) => ({
      id: JobId(`bash-${index + 1}`),
      kind: 'bash',
      label: 'sleep 60',
      status,
      startedAt: 0,
      output: { total: 0, earliest: 0 },
    }))
  }
  get(): never { throw new Error('unsupported') }
  read(): never { throw new Error('unsupported') }
  readAt(): never { throw new Error('unsupported') }
  kill(): never { throw new Error('unsupported') }
  wait(): never { throw new Error('unsupported') }
  remove(): never { throw new Error('unsupported') }
  attachController(): () => void { return () => {} }
}

beforeEach(() => {
  productActive = false
  jobs = []
  ctx = new Context()
  // Narrow service doubles exercise the inspector against a real Cordis event lifecycle.
  new RosterOnlyJobRegistry(ctx)
  ctx.on('desktop/active-tasks', async () => productActive)
  inspect = installDesktopQuitInspection(ctx)
})

afterEach(async () => { await ctx.fiber.dispose() })

describe('Desktop Host quit inspection', () => {
  it('inspects an idle product without Agent or Session services', async () => {
    expect(await inspect()).toEqual({ activeTasks: false, scheduledTasks: false })
  })

  it('uses the product work state without starting or stopping tasks', async () => {
    productActive = true
    expect(await inspect()).toEqual({ activeTasks: true, scheduledTasks: false })
    productActive = false
    expect(await inspect()).toEqual({ activeTasks: false, scheduledTasks: false })
  })

  it.each(['running', 'stopping'] as const)('counts %s global jobs', async (status) => {
    jobs = [status]
    expect(await inspect()).toEqual({ activeTasks: true, scheduledTasks: false })
    jobs = ['completed']
    expect(await inspect()).toEqual({ activeTasks: false, scheduledTasks: false })
  })

  it('rejects an absent or failing product inspector instead of reporting idle', async () => {
    const empty = new Context()
    try {
      new RosterOnlyJobRegistry(empty)
      const check = installDesktopQuitInspection(empty)
      await expect(check()).rejects.toThrow('product inspector is unavailable')
      empty.on('desktop/active-tasks', async () => { throw new Error('storage unavailable') })
      await expect(check()).rejects.toThrow('storage unavailable')
    } finally { await empty.fiber.dispose() }
  })

  it('does not classify unavailable task services as idle', async () => {
    const empty = new Context()
    try {
      await expect(installDesktopQuitInspection(empty)()).rejects.toThrow('jobs service is unavailable')
    } finally { await empty.fiber.dispose() }
  })

  it('refuses inspection after disposal', async () => {
    expect(await inspect()).toEqual({ activeTasks: false, scheduledTasks: false })
    await ctx.fiber.dispose()
    await expect(inspect()).rejects.toThrow('Host is stopping')
  })
})
