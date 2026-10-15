import { Context, Service } from 'cordis'
import type { ApiClient } from '../sdk'
declare module 'cordis' { interface Events { 'client/unauthorized'(): void } }
export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); this.name = 'HttpError' }
}
export class ApiService extends Service implements ApiClient {
  private csrf = ''
  private reads = new Set<AbortController>()
  constructor(ctx: Context) { super(ctx, 'apiClient'); ctx.effect(() => () => this.abortReads()) }
  setCsrf(token: string) { this.csrf = token }
  clearSession() { this.csrf = ''; this.abortReads() }
  abortReads() { for (const controller of this.reads) controller.abort(); this.reads.clear() }
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('API requests require a same-origin /api/ path')
    const headers = new Headers(init.headers)
    const method = (init.method ?? 'GET').toUpperCase()
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    if (!['GET', 'HEAD'].includes(method) && this.csrf) headers.set('X-CSRF-Token', this.csrf)
    const controller = new AbortController()
    const abort = () => controller.abort(init.signal?.reason)
    if (init.signal?.aborted) abort()
    init.signal?.addEventListener('abort', abort, { once: true })
    if (['GET', 'HEAD'].includes(method)) this.reads.add(controller)
    try {
      const response = await fetch(path, { ...init, headers, signal: controller.signal, credentials: 'include', cache: 'no-store' })
      const body = response.status === 204 ? '' : await response.text()
      if (!response.ok) {
        if (response.status === 401 && !path.startsWith('/api/auth/')) this.ctx.emit('client/unauthorized')
        let detail: { error?: { message?: string; code?: string }; detail?: string } = {}
        try { detail = JSON.parse(body) } catch { /* The original HTTP response remains the diagnostic. */ }
        throw new HttpError(detail.error?.message ?? detail.detail ?? body.slice(0, 500) ?? response.statusText, response.status, detail.error?.code)
      }
      if (!body) return undefined as T
      if (response.headers.get('content-type')?.includes('application/json')) return JSON.parse(body) as T
      return body as T
    } finally { this.reads.delete(controller); init.signal?.removeEventListener('abort', abort) }
  }
}
export const name = 'client-api'
export function apply(ctx: Context) { new ApiService(ctx) }
