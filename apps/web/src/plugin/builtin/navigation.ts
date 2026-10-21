import { Context, Service } from 'cordis'
import { matchRoute, type Navigation } from '../sdk'
export class NavigationService extends Service implements Navigation {
  private listeners = new Set<() => void>()
  private blockers = new Set<(path: string) => Promise<boolean>>()
  private index = 0
  private navigating = false
  private restore: (() => void) | null = null
  private passPop = false
  constructor(ctx: Context) {
    super(ctx, 'navigation')
    window.history.replaceState({ ...window.history.state, youdubIndex: 0 }, '', window.location.href)
    const changed = async (event: PopStateEvent) => {
      if (this.restore) { const done = this.restore; this.restore = null; done(); return }
      const nextIndex = Number(event.state?.youdubIndex ?? 0)
      if (this.passPop) { this.passPop = false; this.index = nextIndex; this.changed(); return }
      const path = this.getSnapshot()
      if (this.blockers.size && nextIndex !== this.index) {
        const delta = nextIndex - this.index
        await new Promise<void>((resolve) => { this.restore = resolve; window.history.go(-delta) })
        if (await this.canLeave(path)) { this.passPop = true; window.history.go(delta) }
      } else { this.index = nextIndex; this.changed() }
    }
    ctx.effect(() => { window.addEventListener('popstate', changed); return () => window.removeEventListener('popstate', changed) })
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => window.location.pathname + window.location.search
  block(handler: (path: string) => Promise<boolean>) { this.blockers.add(handler); return () => { this.blockers.delete(handler) } }
  private changed() { for (const listener of this.listeners) listener() }
  private async canLeave(path: string) { for (const handler of this.blockers) if (!await handler(path)) return false; return true }
  push(path: string) { void this.navigate(path, false) }
  replace(path: string) { void this.navigate(path, true) }
  private async navigate(path: string, replace: boolean) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Navigation requires a same-origin path')
    if (this.navigating || path === this.getSnapshot()) return
    this.navigating = true
    try {
      if (this.blockers.size && !await this.canLeave(path)) return
      const standalone = (value: string) => this.ctx.slots.list('shell.routes').some(route => route.layout === 'standalone' && matchRoute(value.split('?')[0], route.path))
      const returnTo = standalone(path) ? (standalone(this.getSnapshot()) ? window.history.state?.youdubReturnTo ?? '/' : this.getSnapshot()) : undefined
      if (!replace) this.index++
      window.history[replace ? 'replaceState' : 'pushState']({ youdubIndex: this.index, ...(returnTo ? { youdubReturnTo: returnTo } : {}) }, '', path)
      this.changed()
    } finally { this.navigating = false }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }
  href(routeId: string, params: Record<string, string> = {}) {
    const route = this.ctx.slots.list('shell.routes').find((entry) => entry.id === routeId)
    if (!route) throw new Error(`Unknown route: ${routeId}`)
    return route.path.replace(/:([^/]+)/g, (_, key: string) => {
      if (!(key in params)) throw new Error(`Missing route parameter: ${key}`)
      return encodeURIComponent(params[key])
    })
  }
}
export const name = 'client-navigation'
export const inject = ['slots']
export function apply(ctx: Context) { new NavigationService(ctx) }
