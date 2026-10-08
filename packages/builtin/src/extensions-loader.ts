import type { Context } from 'cordis'
import '@cordisjs/plugin-loader'
import './extensions.js'

export const name = 'extensions-loader'
export const inject = ['extensions', 'loader']
export async function apply(ctx: Context) {
  for (const entry of ctx.extensions.hostEntries()) {
    const id = await ctx.loader.create(entry)
    ctx.effect(() => () => ctx.loader.remove(id))
    const loaded = ctx.loader.resolve(id)
    await loaded.fiber?.await()
    if (loaded.fiber?.state !== 2) throw new Error(`Extension failed to activate: ${entry.id}`)
    ctx.extensions.markActive(entry.id)
  }
}
