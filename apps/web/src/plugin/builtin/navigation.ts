import { Context, Service } from 'cordis'
import { matchRoute, type Navigation } from '../sdk'
type HistoryEntry = { youdubIndex?: number; youdubReturnTo?: string; youdubDialogFromIndex?: number }
type Blocker = { handler: (path: string) => Promise<boolean>; scope: 'page' | 'dialog' }
export class NavigationService extends Service implements Navigation {
  private listeners = new Set<() => void>()
  private blockers = new Set<Blocker>()
  private index = 0
  private navigating = false
  private restore: (() => void) | null = null
  private passPop = false
  constructor(ctx: Context) {
    super(ctx, 'navigation')
    this.index = Number.isSafeInteger(window.history.state?.youdubIndex) ? window.history.state.youdubIndex : 0
    window.history.replaceState({ ...window.history.state, youdubIndex: this.index }, '', window.location.href)
    const changed = async (event: PopStateEvent) => {
      if (this.restore) { const done = this.restore; this.restore = null; done(); return }
      const nextIndex = Number(event.state?.youdubIndex ?? 0)
      if (this.passPop) { this.passPop = false; this.index = nextIndex; this.changed(); return }
      const path = this.getSnapshot()
      if (this.blockers.size && nextIndex !== this.index) {
        const targetState = event.state as HistoryEntry | null
        const delta = nextIndex - this.index
        await new Promise<void>((resolve) => { this.restore = resolve; window.history.go(-delta) })
        if (await this.canLeave(path, this.blockersFor(path, targetState))) { this.passPop = true; window.history.go(delta) }
      } else { this.index = nextIndex; this.changed() }
    }
    ctx.effect(() => { window.addEventListener('popstate', changed); return () => window.removeEventListener('popstate', changed) })
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => window.location.pathname + window.location.search
  block(handler: (path: string) => Promise<boolean>, scope: 'page' | 'dialog' = 'page') {
    const blocker = { handler, scope }
    this.blockers.add(blocker)
    return () => { this.blockers.delete(blocker) }
  }
  private changed() { for (const listener of this.listeners) listener() }
  private layout(path: string) { return this.ctx.slots.list('shell.routes').find(route => matchRoute(path.split('?')[0], route.path))?.layout }
  private background(path: string, state: HistoryEntry | null) { return this.layout(path) === 'dialog' ? state?.youdubReturnTo ?? '/' : path }
  private blockersFor(path: string, state: HistoryEntry | null): Blocker[] {
    const current = this.getSnapshot()
    const pageChanges = this.background(current, window.history.state) !== this.background(path, state)
    const dialogChanges = this.layout(current) === 'dialog'
    return [...this.blockers].filter(blocker => blocker.scope === 'dialog' ? dialogChanges : pageChanges)
      .sort((a, b) => Number(a.scope === 'page') - Number(b.scope === 'page'))
  }
  private async canLeave(path: string, blockers: Blocker[]) { for (const { handler } of blockers) if (!await handler(path)) return false; return true }
  push(path: string) { void this.navigate(path, false) }
  replace(path: string) { void this.navigate(path, true) }
  dismissDialog() {
    if (this.layout(this.getSnapshot()) !== 'dialog' || this.navigating) return
    if (window.history.state?.youdubDialogFromIndex === this.index - 1) window.history.back()
    else this.replace(window.history.state?.youdubReturnTo ?? '/')
  }
  private async navigate(path: string, replace: boolean) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Navigation requires a same-origin path')
    if (this.navigating || path === this.getSnapshot()) return
    this.navigating = true
    const current = this.getSnapshot()
    const currentLayout = this.layout(current)
    const nextLayout = this.layout(path)
    const currentState = window.history.state as HistoryEntry | null
    const returnTo = nextLayout === 'dialog' || nextLayout === 'standalone'
      ? (currentLayout === nextLayout ? currentState?.youdubReturnTo ?? '/' : current)
      : undefined
    if (currentLayout === 'dialog' && nextLayout === 'dialog') replace = true
    const dialogFromIndex = nextLayout === 'dialog'
      ? (currentLayout === 'dialog' ? currentState?.youdubDialogFromIndex : !replace ? this.index : undefined)
      : undefined
    const state: HistoryEntry = {
      youdubIndex: this.index + (replace ? 0 : 1),
      ...(returnTo ? { youdubReturnTo: returnTo } : {}),
      ...(dialogFromIndex !== undefined ? { youdubDialogFromIndex: dialogFromIndex } : {}),
    }
    const backgroundChanges = this.background(current, currentState) !== this.background(path, state)
    try {
      const blockers = this.blockersFor(path, state)
      if (blockers.length && !await this.canLeave(path, blockers)) return
      this.index = state.youdubIndex!
      window.history[replace ? 'replaceState' : 'pushState'](state, '', path)
      this.changed()
    } finally { this.navigating = false }
    if (backgroundChanges) window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
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
