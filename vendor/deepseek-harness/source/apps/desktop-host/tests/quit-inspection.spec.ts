import { Context } from '@deepseek-ai/cordis'
import { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installDesktopQuitInspection } from '../src/quit-inspection.ts'

let ctx: Context
let inspect: ReturnType<typeof installDesktopQuitInspection>
let productActive = false
let jobsActive = false
/** A registry exposing only the activity state needed by quit inspection. */
class ActivityOnlyJobRegistry extends JobRegistry {
  start(): never { throw new Error('unsupported') }
  hasActiveJobs() { return jobsActive }
  attachController(): () => void { return () => {} }
}

beforeEach(() => {
  productActive = false
  jobsActive = false
  ctx = new Context()
  // Narrow service doubles exercise the inspector against a real Cordis event lifecycle.
  new ActivityOnlyJobRegistry(ctx)
  ctx.on('desktop/active-tasks', async () => productActive)
  inspect = installDesktopQuitInspection(ctx)
})

afterEach(async () => { await ctx.fiber.dispose() })

describe('Desktop Host quit inspection', () => {
  it('inspects an idle product without Agent or Session services', async () => {
    expect(await inspect()).toEqual({ activeTasks: false })
  })

  it('uses the product work state without starting or stopping tasks', async () => {
    productActive = true
    expect(await inspect()).toEqual({ activeTasks: true })
    productActive = false
    expect(await inspect()).toEqual({ activeTasks: false })
  })

  it('counts active background jobs', async () => {
    jobsActive = true
    expect(await inspect()).toEqual({ activeTasks: true })
    jobsActive = false
    expect(await inspect()).toEqual({ activeTasks: false })
  })

  it('rejects an absent or failing product inspector instead of reporting idle', async () => {
    const empty = new Context()
    try {
      new ActivityOnlyJobRegistry(empty)
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
    expect(await inspect()).toEqual({ activeTasks: false })
    await ctx.fiber.dispose()
    await expect(inspect()).rejects.toThrow('Host is stopping')
  })
})
