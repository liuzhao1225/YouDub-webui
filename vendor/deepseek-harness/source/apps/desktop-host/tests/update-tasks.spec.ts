import { Context } from '@deepseek-ai/cordis'
import { JobRegistry } from '@deepseek-ai/dsh-jobs'
import { expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { installDesktopUpdateTaskControl } from '../src/update-tasks.ts'

class IdleJobs extends JobRegistry {
  start(): never { throw new Error('unsupported') }
  hasActiveJobs() { return false }
  attachController(): () => void { return () => {} }
}

it('drains a previously admitted request and sees work it creates, refusing new requests until unlocked', async () => {
  const ctx = new Context()
  try {
    new IdleJobs(ctx)
    let active = false
    ctx.on('desktop/active-tasks', async () => active)
    const control = installDesktopUpdateTaskControl(ctx)
    const admitted = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>()
    const request = {} as IncomingMessage
    let status = 200, ran = false
    const response = { writeHead: (value: number) => { status = value }, end() {} } as unknown as ServerResponse
    const running = ctx.waterfall('connection/request', request, response, async () => {
      admitted.resolve(); await finish.promise; active = true
    })
    await admitted.promise
    const locking = control('lock')
    await ctx.waterfall('connection/request', request, response, async () => { ran = true })
    expect(status).toBe(503)
    expect(ran).toBe(false)
    finish.resolve()
    await running
    expect(await locking).toBe(true)
    await control('unlock')
    await ctx.waterfall('connection/request', request, response, async () => { ran = true })
    expect(ran).toBe(true)
  } finally { await ctx.fiber.dispose() }
})

it('an unlock supersedes a draining lock, so a timed-out lock cannot later authorize installation', async () => {
  const ctx = new Context()
  try {
    new IdleJobs(ctx)
    ctx.on('desktop/active-tasks', async () => false)
    const control = installDesktopUpdateTaskControl(ctx)
    const admitted = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>()
    const pending = ctx.waterfall('connection/request', {} as IncomingMessage, {} as ServerResponse, async () => {
      admitted.resolve(); await finish.promise
    })
    await admitted.promise
    const locking = control('lock')
    await control('unlock')
    finish.resolve()
    await pending
    await expect(locking).rejects.toThrow('superseded')
  } finally { await ctx.fiber.dispose() }
})
