import type { Context } from 'cordis'
import '@cordisjs/plugin-loader'
import './extensions.js'

export const name = 'extensions-loader'
export const inject = ['extensions', 'loader']
export async function apply(ctx: Context) {
  const loaded = []
  for (const entry of ctx.extensions.hostEntries()) {
    const id = await ctx.loader.create(entry)
    const instance = ctx.loader.resolve(id)
    loaded.push(instance)
    ctx.effect(() => async () => { ctx.loader.remove(id); await instance.fiber?.await() })
  }
  // All services must be registered before checking pending consumers. Waiting
  // on the whole Loader here would also wait on this plugin's own activation.
  while (true) {
    const tasks = loaded.flatMap(entry => entry.fiber?.inertia ? [entry.fiber.inertia] : [])
    if (!tasks.length) break
    await Promise.allSettled(tasks)
  }
  for (const entry of loaded) {
    await entry.fiber?.await()
    if (entry.fiber?.state !== 2) throw new Error(`Extension failed to activate: ${entry.id}`)
    ctx.extensions.markActive(entry.options.id)
  }
}
