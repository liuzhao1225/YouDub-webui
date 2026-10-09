import { Context, Service } from 'cordis'
import type { Navigation } from '../sdk'
export class NavigationService extends Service implements Navigation {
  private listeners = new Set<() => void>()
  constructor(ctx: Context) {
    super(ctx, 'navigation')
    const changed = () => { for (const listener of this.listeners) listener() }
    ctx.effect(() => { window.addEventListener('popstate', changed); return () => window.removeEventListener('popstate', changed) })
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => window.location.pathname + window.location.search
  push(path: string) { this.navigate(path, false) }
  replace(path: string) { this.navigate(path, true) }
  private navigate(path: string, replace: boolean) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Navigation requires a same-origin path')
    window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
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
