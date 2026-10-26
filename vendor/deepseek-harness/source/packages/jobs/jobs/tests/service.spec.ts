import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { JobRegistry } from '@deepseek-ai/dsh-jobs'

class StubJobRegistry extends JobRegistry {
  start(): never { throw new Error('unused') }
  list() { return [] }
  attachController() { return () => {} }
}

describe('JobRegistry composition', () => {
  it('registers one implementation and rejects a duplicate service', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(StubJobRegistry)
      expect(ctx.jobs.list()).toEqual([])
      class SecondJobRegistry extends StubJobRegistry {}
      await expect(ctx.plugin(SecondJobRegistry)).rejects.toThrow(/service "jobs" has been registered/)
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects the abstract seam in a stale composition', async () => {
    const ctx = new Context()
    try {
      await expect(ctx.plugin(JobRegistry as typeof StubJobRegistry)).rejects.toThrow(/abstract job registry seam/)
    } finally { await ctx.fiber.dispose() }
  })
})
