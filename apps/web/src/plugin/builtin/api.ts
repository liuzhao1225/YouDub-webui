import { Context, Service } from 'cordis'
import type { ApiClient } from '../sdk'
import { responseBody } from '@/runtime/http'
export { HttpError } from '@/runtime/http'
declare module 'cordis' {
  interface Events {
    'client/unauthorized'(): void
    'client/mutated'(path: string, method: string, body: RequestInit['body']): void
    'client/session-cleared'(): void
  }
}
export class ApiService extends Service implements ApiClient {
  private csrf = ''
  private reads = new Set<AbortController>()
  constructor(ctx: Context) { super(ctx, 'apiClient'); ctx.effect(() => () => this.abortReads()) }
  setCsrf(token: string) { this.csrf = token }
  clearSession() { this.csrf = ''; this.abortReads(); this.ctx.emit('client/session-cleared') }
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
      let value: T
      try { value = await responseBody<T>(response) }
      catch (error) {
        if (response.status === 401 && !path.startsWith('/api/auth/')) this.ctx.emit('client/unauthorized')
        throw error
      }
      if (!['GET', 'HEAD'].includes(method)) this.ctx.emit('client/mutated', path, method, init.body)
      return value
    } finally { this.reads.delete(controller); init.signal?.removeEventListener('abort', abort) }
  }
}
export const name = 'client-api'
export function apply(ctx: Context) { new ApiService(ctx) }
