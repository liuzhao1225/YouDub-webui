import { Context, Service } from 'cordis'
import type { Session, SessionSnapshot } from '../sdk'
type AuthSession = { csrf_token: string; authenticated: true }
export class SessionService extends Service implements Session {
  private snapshot: SessionSnapshot = { status: 'loading' }
  private listeners = new Set<() => void>()
  private expiration: Promise<void> | null = null
  constructor(ctx: Context) {
    super(ctx, 'session')
    ctx.on('client/unauthorized', () => { void this.expire().catch((error: Error) => this.publish({ status: 'error', error: error.message })) })
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.snapshot
  private publish(next: SessionSnapshot) { this.snapshot = next; for (const listener of this.listeners) listener() }
  async initialize() {
    let session: AuthSession
    try {
      session = await this.ctx.apiClient.request<AuthSession>('/api/auth/session')
      await this.authenticated(session)
    }
    catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 401) { this.publish({ status: 'anonymous' }); this.ctx.navigation.replace('/login'); return }
      this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) }); throw error
    }
  }
  private async authenticated(session: AuthSession) {
    this.ctx.apiClient.setCsrf(session.csrf_token)
    await this.ctx.clientModules.mountAuthenticated()
    this.publish({ status: 'authenticated' })
    if (window.location.pathname === '/login') this.ctx.navigation.replace('/')
  }
  async login(password: string) {
    const session = await this.ctx.apiClient.request<AuthSession>('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
    await this.authenticated(session)
  }
  async logout() {
    try { await this.ctx.apiClient.request<void>('/api/auth/logout', { method: 'POST' }) }
    catch (error) {
      if (!(error instanceof Error) || !('status' in error) || error.status !== 401) throw error
      await this.expire()
      this.publish({ status: 'anonymous', error: error.message })
      return
    }
    await this.expire()
  }
  expire() {
    if (this.expiration) return this.expiration
    this.expiration = (async () => {
      this.publish({ status: 'loading' })
      this.ctx.apiClient.clearSession()
      await this.ctx.clientModules.unmountAuthenticated()
      this.publish({ status: 'anonymous' }); this.ctx.navigation.replace('/login')
    })().catch((error: unknown) => {
      this.publish({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      throw error
    }).finally(() => { this.expiration = null })
    return this.expiration
  }
}
export const name = 'client-session'
export const inject = ['apiClient', 'navigation', 'clientModules']
export function apply(ctx: Context) {
  const session = new SessionService(ctx)
  void session.initialize().catch((error) => ctx.logger.error(error))
}
