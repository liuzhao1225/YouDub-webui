import { Service, type Context } from 'cordis'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { type HttpRequest } from './http.js'
import { AppError } from '@youdub/sdk'

interface AuthSettings { cookieName: string; sessionTtlSeconds: number; cookieSecure: boolean; cookieSameSite: 'lax' | 'strict'; credentialVersion: string }
interface Session { tokenHash: string; csrfToken: string; expiresAt: string }
export interface AuthConfig { allowedOrigins?: string[]; allowedOriginRegex?: string }
const digest = (prefix: string, token: string) => createHash('sha256').update(`${prefix}\0${token}`).digest('base64url')
const iso = (time = Date.now()) => new Date(time).toISOString().replace(/\.\d{3}Z$/, '+00:00')
const equal = (a: string, b: string) => { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right) }
declare module 'cordis' { interface Context { auth: AuthService } }

export default class AuthService extends Service {
  static inject = ['http', 'store']
  private settings!: AuthSettings
  private origins: Set<string>
  private originRegex: RegExp
  constructor(ctx: Context, config: AuthConfig = {}) {
    super(ctx, 'auth')
    this.origins = new Set(config.allowedOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000', ...(process.env.CORS_ALLOW_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)])
    if (this.origins.has('*')) throw new Error('CORS_ALLOW_ORIGINS cannot contain wildcard origins.')
    this.originRegex = new RegExp(config.allowedOriginRegex || process.env.CORS_ALLOW_ORIGIN_REGEX || '^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):3000$')
  }
  async [Service.init]() {
    this.settings = await this.ctx.store.call('auth.validate', {})
    this.ctx.effect(() => this.ctx.http.use(async (request, next) => {
      if (!request.url.pathname.startsWith('/api/')) return next()
      // Setup has its own loopback/origin/token guard and also runs before Store.
      if (request.url.pathname === '/api/setup') return next()
      const origin = request.raw.headers.origin
      if (origin && this.originAllowed(request)) {
        request.response.setHeader('Access-Control-Allow-Origin', origin)
        request.response.setHeader('Access-Control-Allow-Credentials', 'true')
        request.response.setHeader('Vary', 'Origin')
      }
      request.response.setHeader('Cache-Control', 'no-store')
      if (request.raw.method === 'OPTIONS') {
        if (!this.originAllowed(request)) throw new AppError('ORIGIN_NOT_ALLOWED', 'Origin is not allowed.', 403)
        request.response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS')
        request.response.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-CSRF-Token,Range')
        this.ctx.http.json(request, 204); return
      }
      if (request.url.pathname === '/api/health') return next()
      let session = await this.authenticate(request)
      if (!session && request.url.pathname === '/api/auth/session' && request.raw.method === 'GET') {
        if (!this.originAllowed(request)) throw new AppError('ORIGIN_NOT_ALLOWED', 'Origin is not allowed.', 403)
        session = await this.createSession(request)
      }
      if (session) request.state.session = session
      if (request.url.pathname === '/api/v2/client-manifest' || request.url.pathname.startsWith('/api/plugins/')) return next()
      if (!session) { this.clearCookie(request); throw new AppError('UNAUTHORIZED', 'Authentication required.', 401) }
      if (!['GET', 'HEAD'].includes(request.raw.method || '')) {
        if (!equal(String(request.raw.headers['x-csrf-token'] || ''), session.csrfToken)) throw new AppError('CSRF_INVALID', 'CSRF validation failed.', 403)
        if (!this.originAllowed(request)) throw new AppError('ORIGIN_NOT_ALLOWED', 'Origin is not allowed.', 403)
      }
      await next()
    }))
    this.ctx.effect(() => this.ctx.http.register('GET', '/api/auth/session', request => {
      const session = request.state.session as Session
      this.ctx.http.json(request, 200, { authenticated: true, csrf_token: session.csrfToken, expires_at: session.expiresAt })
    }))
    this.ctx.effect(() => this.ctx.http.register('POST', '/api/auth/logout', async request => {
      await this.ctx.store.call('auth.delete_session', { token_hash: (request.state.session as Session).tokenHash })
      this.clearCookie(request)
      this.ctx.http.json(request, 204)
    }))
  }
  private originAllowed(request: HttpRequest) {
    const origin = request.raw.headers.origin
    return !origin || request.raw.headers['sec-fetch-site'] === 'same-origin' || this.origins.has(origin) || this.originRegex.test(origin)
  }
  private token(request: HttpRequest) {
    for (const cookie of (request.raw.headers.cookie || '').split(';')) {
      const index = cookie.indexOf('=')
      if (cookie.slice(0, index).trim() === this.settings.cookieName) return cookie.slice(index + 1).trim()
    }
    return ''
  }
  private cookie(token: string, expiresAt?: string) {
    return `${this.settings.cookieName}=${token}; Path=/api; HttpOnly; SameSite=${this.settings.cookieSameSite}; Max-Age=${token ? this.settings.sessionTtlSeconds : 0}; Expires=${token ? new Date(expiresAt!).toUTCString() : new Date(0).toUTCString()}${this.settings.cookieSecure ? '; Secure' : ''}`
  }
  private clearCookie(request: HttpRequest) { request.response.setHeader('Set-Cookie', this.cookie('')) }
  async authenticate(request: HttpRequest): Promise<Session | null> {
    const token = this.token(request)
    if (!token || token.length > 256) return null
    const tokenHash = digest('youdub-session', token)
    const row = await this.ctx.store.call('auth.get_session', { token_hash: tokenHash })
    if (!row) return null
    if (row.expires_at <= iso() || !equal(String(row.credential_version), this.settings.credentialVersion)) {
      await this.ctx.store.call('auth.delete_session', { token_hash: tokenHash }); return null
    }
    return { tokenHash, csrfToken: digest('youdub-csrf', token), expiresAt: row.expires_at }
  }
  private async createSession(request: HttpRequest): Promise<Session> {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = iso(Date.now() + this.settings.sessionTtlSeconds * 1000)
    await this.ctx.store.call('auth.delete_expired_sessions', { expires_before: iso() })
    await this.ctx.store.call('auth.create_session', { token_hash: digest('youdub-session', token), credential_version: this.settings.credentialVersion, created_at: iso(), expires_at: expiresAt })
    request.response.setHeader('Set-Cookie', this.cookie(token, expiresAt))
    return { tokenHash: digest('youdub-session', token), csrfToken: digest('youdub-csrf', token), expiresAt }
  }
}
