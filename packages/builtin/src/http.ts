import { Service, type Context } from 'cordis'
import { AppError } from '@youdub/sdk'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

export interface HttpRequest {
  raw: IncomingMessage
  response: ServerResponse
  url: URL
  params: Record<string, string>
  state: Record<string, unknown>
}
export type Handler = (request: HttpRequest) => void | Promise<void>
export type Middleware = (request: HttpRequest, next: () => Promise<void>) => void | Promise<void>
export interface HttpConfig { host: string; port: number }
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler }
declare module 'cordis' { interface Context { http: HttpService } }

export default class HttpService extends Service {
  private routes: Route[] = []
  private middleware: Middleware[] = []
  private server?: Server
  private closing?: Promise<void>
  private requests = new Set<Promise<void>>()
  public ready = false
  public address: string | null = null

  constructor(ctx: Context, private config: HttpConfig) {
    super(ctx, 'http')
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535 || !config.host) {
      throw new Error('HTTP requires an explicit host and valid port.')
    }
  }

  async [Service.init]() {
    this.ctx.on('app/ready', () => { this.ready = true })
    this.ctx.on('app/stopping', () => this.close())
    const server = this.server = createServer((raw, response) => {
      if (!this.ready) {
        response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' })
        response.end(JSON.stringify({ error: { code: 'HOST_NOT_READY', message: this.closing ? 'Application is stopping.' : 'Application is starting.' } }))
        return
      }
      const request = this.dispatch(raw, response).catch(error => {
        const status = Number(error.status ?? error.statusCode) || 500
        if (status >= 500) this.ctx.logger.error(error)
        else this.ctx.logger.warn(error)
        if (response.headersSent) { response.destroy(error instanceof Error ? error : undefined); return }
        response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify({ error: { code: error.code || 'INTERNAL_ERROR', message: status >= 500 ? 'Request failed. See host diagnostics.' : error.message }, detail: status >= 500 ? 'Request failed. See host diagnostics.' : error.message }))
      }).finally(() => { this.requests.delete(request) })
      this.requests.add(request)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.config.port, this.config.host, () => { server.off('error', reject); resolve() })
    })
    server.on('error', error => this.ctx.logger.error(error))
    const bound = server.address()
    if (bound && typeof bound === 'object') this.address = `http://${this.config.host}:${bound.port}`
    return () => this.close()
  }

  private close() {
    this.ready = false
    return this.closing ??= (async () => {
      const closed = new Promise<void>((resolve, reject) => this.server!.close(error => error ? reject(error) : resolve()))
      this.server!.closeIdleConnections()
      await closed
      await Promise.all(this.requests)
    })()
  }

  register(method: string, path: string, handler: Handler) {
    const keys: string[] = []
    const parts = path.split('/').map(part => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const wildcard = part.endsWith('*')
      keys.push(part.slice(1, wildcard ? -1 : undefined))
      return wildcard ? '(.*)' : '([^/]+)'
    })
    const pattern = new RegExp(`^${parts.join('/')}/?$`)
    const verb = method.toUpperCase()
    if (this.routes.some(route => route.method === verb && route.pattern.source === pattern.source)) throw new Error(`Duplicate route: ${verb} ${path}`)
    const route = { method: verb, pattern, keys, handler }
    this.routes.push(route)
    return () => { this.routes = this.routes.filter(item => item !== route) }
  }

  use(middleware: Middleware) {
    this.middleware.push(middleware)
    return () => { this.middleware = this.middleware.filter(item => item !== middleware) }
  }

  private async dispatch(raw: IncomingMessage, response: ServerResponse) {
    const request: HttpRequest = { raw, response, url: new URL(raw.url || '/', 'http://localhost'), params: {}, state: {} }
    const match = this.routes.map(route => ({ route, match: route.pattern.exec(request.url.pathname) })).find(item => item.match && (item.route.method === raw.method || raw.method === 'HEAD' && item.route.method === 'GET'))
    if (match) {
      try { match.route.keys.forEach((key, index) => { request.params[key] = decodeURIComponent(match.match![index + 1]!) }) }
      catch { throw new AppError('INVALID_PATH', 'Invalid URL encoding.', 400) }
    }
    let index = 0
    const next = async () => {
      const middleware = this.middleware[index++]
      if (middleware) { await middleware(request, next); return }
      if (!match) throw new AppError('NOT_FOUND', 'Route not found.', 404)
      await match.route.handler(request)
    }
    await next()
  }

  json(request: HttpRequest, status: number, body?: unknown) {
    request.response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    request.response.end(request.raw.method === 'HEAD' || body === undefined ? undefined : JSON.stringify(body))
  }

  async file(request: HttpRequest, path: string, options: { mime: string; name?: string; download?: boolean }) {
    const info = await stat(path)
    if (!info.isFile()) throw new AppError('OUTPUT_NOT_FOUND', 'File not found.', 404)
    let start = 0, end = info.size - 1, status = 200
    const range = request.raw.headers.range
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2]) || info.size === 0) {
        request.response.setHeader('Content-Range', `bytes */${info.size}`)
        throw new AppError('RANGE_NOT_SATISFIABLE', 'Invalid byte range.', 416)
      }
      if (!match[1]) start = Math.max(0, info.size - Number(match[2]))
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        request.response.setHeader('Content-Range', `bytes */${info.size}`)
        throw new AppError('RANGE_NOT_SATISFIABLE', 'Byte range exceeds file size.', 416)
      }
      status = 206
      request.response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
    }
    request.response.setHeader('Accept-Ranges', 'bytes')
    request.response.setHeader('Content-Type', options.mime)
    request.response.setHeader('X-Content-Type-Options', 'nosniff')
    request.response.setHeader('Content-Length', Math.max(0, end - start + 1))
    request.response.setHeader('Cache-Control', 'no-store')
    if (options.name) request.response.setHeader('Content-Disposition', `${options.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(options.name)}`)
    request.response.writeHead(status)
    if (request.raw.method === 'HEAD' || info.size === 0) { request.response.end(); return }
    await pipeline(createReadStream(path, { start, end }), request.response)
  }
}

export async function readJson(request: HttpRequest, limit = 1024 * 1024): Promise<any> {
  const buffers: Buffer[] = []; let bytes = 0
  for await (const chunk of request.raw) {
    bytes += chunk.length
    if (bytes > limit) throw new AppError('FILE_TOO_LARGE', 'Request body is too large.', 413)
    buffers.push(Buffer.from(chunk))
  }
  try {
    const value = buffers.length ? JSON.parse(Buffer.concat(buffers).toString('utf8')) : {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.')
    return value
  }
  catch { throw new AppError('INVALID_JSON', 'Invalid JSON request.', 400) }
}
