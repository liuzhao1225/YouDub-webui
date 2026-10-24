import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'

/** Mount a host plugin and mint a scope inside it. */
async function mintScope(ctx: Context): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin((inner: Context) => { scope = createScope(inner) })
  return scope
}

describe('createScope', () => {
  it('is usable synchronously before the backing fiber activates', async () => {
    const ctx = new Context()
    const events: string[] = []
    let scope!: Scope
    await ctx.plugin((inner: Context) => {
      scope = createScope(inner)
      scope.ctx.effect(() => () => void events.push('disposed'))
      events.push('registered')
    })
    expect(events).toEqual(['registered'])
    await scope.dispose()
    expect(events).toEqual(['registered', 'disposed'])
  })

  it('shares quiescence across repeat and raw-disposer-first calls', async () => {
    const ctx = new Context()
    const scope = await mintScope(ctx)
    const gate = Promise.withResolvers<undefined>()
    let finished = false
    scope.ctx.effect(() => async () => {
      await gate.promise
      finished = true
    })

    const raw = Promise.resolve(scope.rawDispose())
    const publicDispose = scope.dispose()
    await Promise.resolve()
    expect(finished).toBe(false)
    gate.resolve(undefined)
    await Promise.all([raw, publicDispose, scope.dispose()])
    expect(finished).toBe(true)
  })

  it('exposes the exact raw disposer for ordered composite teardown', async () => {
    const ctx = new Context()
    const order: string[] = []
    let dispose!: () => Promise<void> | void
    await ctx.plugin((inner: Context) => {
      dispose = inner.effect(function* () {
        yield () => void order.push('outer')
        const scope = createScope(inner)
        scope.ctx.effect(() => () => void order.push('scope'))
        yield scope.rawDispose
        yield () => void order.push('inner')
      })
    })
    await dispose()
    expect(order).toEqual(['inner', 'scope', 'outer'])
  })
})
