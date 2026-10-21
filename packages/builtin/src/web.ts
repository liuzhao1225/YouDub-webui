import type { Context } from 'cordis'
import { realpath, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { AppError } from '@youdub/sdk'
import './http.js'

export interface WebConfig { root: string }
export const name = 'web'
export const inject = ['http']
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.vtt': 'text/vtt; charset=utf-8',
}

/** Serve a built client independently of Python/setup readiness, alongside the API. */
export async function apply(ctx: Context, config: WebConfig) {
  const root = await realpath(config.root)
  const index = await realpath(join(root, 'index.html'))
  if (!index.startsWith(root + sep)) throw new Error(`Web index.html escapes the build directory: ${root}`)
  if (!(await stat(index)).isFile()) throw new Error(`Web build has no index.html: ${root}`)
  ctx.effect(() => ctx.http.use(async (request, next) => {
    if (request.url.pathname === '/api' || request.url.pathname.startsWith('/api/')) return next()
    if (!['GET', 'HEAD'].includes(request.raw.method || '')) return next()
    let pathname: string
    try { pathname = decodeURIComponent(request.url.pathname) }
    catch { throw new AppError('INVALID_PATH', 'Invalid URL encoding.', 400) }
    const parts = pathname.split('/')
    if (pathname.includes('\\') || pathname.includes('\0') || parts.some(part => part.startsWith('.'))) {
      throw new AppError('NOT_FOUND', 'File not found.', 404)
    }
    let file = resolve(root, '.' + pathname)
    if (file !== root && !file.startsWith(root + sep)) throw new AppError('NOT_FOUND', 'File not found.', 404)
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
      file = await realpath(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error
      // Only document navigation falls through to the SPA. Missing assets and
      // API endpoints retain an observable 404 instead of returning HTML.
      if (!request.raw.headers.accept?.includes('text/html') || mime[extname(pathname)] || pathname.startsWith('/assets/') || pathname.startsWith('/plugin-platform/')) return next()
      file = index
    }
    if (!file.startsWith(root + sep)) throw new AppError('NOT_FOUND', 'File not found.', 404)
    await ctx.http.file(request, file, { mime: mime[extname(file).toLowerCase()] || 'application/octet-stream' })
  }))
}
