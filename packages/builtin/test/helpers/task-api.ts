import type { Context } from 'cordis'

const { registerTaskRoutes } = await import(new URL('../../../../apps/harness/src/backend/api.ts', import.meta.url).href)
const { YouDubTransport } = await import(new URL('../../../../apps/harness/src/backend/transport.mjs', import.meta.url).href)

// Exercise the product route handlers and stream transport without a second HTTP server.
// Connection owner authorization is covered by the real Desktop Host tests.
export function taskApi(ctx: Context) {
  const transport = new YouDubTransport(ctx)
  registerTaskRoutes(ctx, transport)
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(path, 'http://youdub.local')
    const physical = new Request(url, init)
    const upload = physical.headers.get('content-type')?.startsWith('multipart/form-data') ?? false
    const body = physical.body && physical.headers.get('content-type')?.includes('application/json') ? await physical.json() : undefined
    const route = url.pathname === '/api/youdub/file' ? url.searchParams.get('path') : url.pathname + url.search
    return transport.dispatch(physical, physical.method === 'HEAD' ? 'GET' : physical.method, route, body, upload)
  }
  return { transport, request }
}
