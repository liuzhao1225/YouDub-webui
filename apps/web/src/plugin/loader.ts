import { Context, Service, type Fiber, type Plugin } from 'cordis'
import { parseManifest, requireActive, type ClientManifest, type ClientModule, type ClientModules } from './sdk'

export async function settleModules(fibers: Array<{ fiber: Fiber; id: string }>) {
  // A pending Fiber has no inertia yet. Drain dependency-triggered activations
  // before checking for unresolved dependencies; awaiting each once is insufficient.
  do {
    await Promise.all(fibers.map(({ fiber }) => fiber.await()))
  } while (fibers.some(({ fiber }) => fiber.state === 1 || fiber.state === 5))
  for (const { fiber, id } of fibers) await requireActive(fiber, id)
}

export async function disposeFiber(ctx: Context, fiber: Fiber) {
  const failures: unknown[] = []
  const detach = ctx.logger.exporter({ export(message) {
    if (message.type === 'error') failures.push(...message.args)
  } })
  try { await fiber.dispose() } finally { await detach() }
  if (failures.length) throw new AggregateError(failures, `Plugin cleanup failed: ${failures.map((error) => error instanceof Error ? error.message : String(error)).join('; ')}`)
}

export class ModuleLoader extends Service implements ClientModules {
  private authenticated: Fiber | null = null
  private authenticatedLoading: Promise<void> | null = null
  private disposed = false
  constructor(ctx: Context) {
    super(ctx, 'clientModules')
    ctx.effect(() => async () => { this.disposed = true; await this.unmountAuthenticated() })
  }
  async manifest(): Promise<ClientManifest> {
    const response = await fetch('/api/v2/client-manifest', { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new Error(`Client manifest failed: ${response.status} ${await response.text()}`)
    return parseManifest(await response.json())
  }
  async mount(entries: ClientModule[], label: string): Promise<Fiber> {
    const modules = await Promise.all(entries.map(async (entry) => ({
      entry, plugin: await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ entry.url) as Plugin,
    })))
    if (this.disposed) throw new Error('Client application was disposed during module loading')
    const group = this.ctx.plugin({ name: label, async apply(ctx: Context) {
      const fibers: Array<{ fiber: Fiber; id: string }> = []
      for (const { entry, plugin } of modules) {
        if (!('apply' in plugin) || typeof plugin.apply !== 'function') throw new Error(`Client entry ${entry.id} must export apply()`)
        for (const url of entry.css ?? []) {
          ctx.effect(() => {
            const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url; document.head.append(link)
            return () => link.remove()
          })
        }
        fibers.push({ fiber: ctx.plugin(plugin, entry.config ?? {}), id: entry.id })
      }
      await settleModules(fibers)
    } })
    await requireActive(group, label)
    return group
  }
  mountAuthenticated(): Promise<void> {
    if (this.authenticated) return Promise.resolve()
    if (this.authenticatedLoading) return this.authenticatedLoading
    this.authenticatedLoading = (async () => {
      const manifest = await this.manifest()
      this.authenticated = await this.mount(manifest.modules.filter((entry) => entry.access === 'authenticated'), 'authenticated-client')
    })().finally(() => { this.authenticatedLoading = null })
    return this.authenticatedLoading
  }
  async unmountAuthenticated() {
    if (this.authenticatedLoading) await this.authenticatedLoading
    if (this.authenticated) { await disposeFiber(this.ctx, this.authenticated); this.authenticated = null }
  }
}
